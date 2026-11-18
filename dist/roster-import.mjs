const clean = value => String(value).normalize('NFKC').trim().replace(/\s+/g,' ');
const norm = value => clean(value).toLocaleLowerCase('ms-MY');
const maximumXmlBytes = 12_500_000;
const maximumPdfPages = 100;

export function parseCsv(text){
  let commas=0, semicolons=0, inQuotes=false;
  for(const char of text){
    if(char==='"') inQuotes=!inQuotes;
    else if(!inQuotes){
      if(char==='\n'||char==='\r') break;
      if(char===',') commas++;
      if(char===';') semicolons++;
    }
  }
  if(!commas||!semicolons) return parseCsvRows(text,semicolons?';':',');
  const commaRows=parseCsvRows(text,',');
  const semicolonRows=parseCsvRows(text,';');
  const eligible=rows=>headerIndex(rows[0]??[])>=0;
  if(!eligible(semicolonRows)) return commaRows;
  if(!eligible(commaRows)) return semicolonRows;
  const consistency=rows=>rows.slice(1).filter(row=>row.some(cell=>cell.trim())).every(row=>row.length===rows[0].length);
  const commaConsistent=consistency(commaRows);
  const semicolonConsistent=consistency(semicolonRows);
  if(commaConsistent!==semicolonConsistent) return commaConsistent?commaRows:semicolonRows;
  throw new Error('Pemisah CSV tidak jelas. Simpan semula fail atau gunakan pilihan Tampal manual.');
}
function parseCsvRows(text,separator){
  const rows=[];
  let row=[], value='', quoted=false;
  for(let i=0;i<text.length;i++){
    const char=text[i];
    if(char==='"'){
      if(quoted&&text[i+1]==='"'){value+='"';i++;}
      else quoted=!quoted;
    } else if(!quoted&&char===separator){
      row.push(value);value='';
    } else if(!quoted&&(char==='\n'||char==='\r')){
      row.push(value); rows.push(row);row=[];value='';
      if(char==='\r'&&text[i+1]==='\n') i++;
    } else {
      value+=char;
    }
  }
  if(quoted) throw new Error('Fail CSV mengandungi tanda petik yang tidak lengkap.');
  if(value||row.length) rows.push([...row,value]);
  return rows;
}
async function openOfficeArchive(file){
  const bytes=new Uint8Array(await file.arrayBuffer());
  const view=new DataView(bytes.buffer);
  const decoder=new TextDecoder();
  const u16=i=>view.getUint16(i,true),u32=i=>view.getUint32(i,true);
  const invalid=()=>new Error('Fail Word atau Excel tidak dapat dibaca.');
  let end=bytes.length-22;
  while(end>=Math.max(0,bytes.length-65557)&&u32(end)!==0x06054b50) end--;
  if(end<Math.max(0,bytes.length-65557)) throw invalid();
  const directory=new Map();
  let ptr=u32(end+16);
  const last=ptr+u32(end+12);
  if(last>end) throw invalid();
  for(let i=0;i<u16(end+10);i++){
    if(ptr+46>last||u32(ptr)!==0x02014b50) throw invalid();
    const nameLength=u16(ptr+28),name=decoder.decode(bytes.subarray(ptr+46,ptr+46+nameLength));
    directory.set(name,{method:u16(ptr+10),size:u32(ptr+20),raw:u32(ptr+24),start:u32(ptr+42)});
    ptr+=46+nameLength+u16(ptr+30)+u16(ptr+32);
    if(ptr>last) throw invalid();
  }
  async function xml(name){
    const f=directory.get(name);
    if(!f) return null;
    if(f.raw>maximumXmlBytes) throw new Error('Kandungan dokumen terlalu besar untuk diproses.');
    if(f.start+30>bytes.length||u32(f.start)!==0x04034b50) throw invalid();
    const start=f.start+30+u16(f.start+26)+u16(f.start+28);
    if(start+f.size>bytes.length) throw invalid();
    const content=bytes.subarray(start,start+f.size);
    let source;
    if(f.method===0){
      if(content.length!==f.raw) throw invalid();
      source=decoder.decode(content);
    }else if(f.method===8) source=await decompressXml(content,f.raw);
    else throw new Error('Jenis mampatan dokumen tidak disokong.');
    const document=new DOMParser().parseFromString(source,'application/xml');
    if(document.querySelector('parsererror')) throw new Error('Kandungan dokumen tidak dapat dibaca.');
    return document;
  }
  return xml;
}
async function decompressXml(content,expectedBytes){
  const reader=new Blob([content]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const decoder=new TextDecoder();
  const parts=[];
  let total=0;
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done) break;
      total+=value.byteLength;
      if(total>maximumXmlBytes||total>expectedBytes){
        await reader.cancel();
        throw new Error('Saiz kandungan dokumen tidak sah atau terlalu besar.');
      }
      parts.push(decoder.decode(value,{stream:true}));
    }
  }finally{reader.releaseLock();}
  if(total!==expectedBytes) throw new Error('Fail Word atau Excel tidak lengkap.');
  parts.push(decoder.decode());
  return parts.join('');
}
async function parseXlsx(file){
  const xml=await openOfficeArchive(file);
  const sheetId=(await xml('xl/workbook.xml'))?.getElementsByTagName('sheet')[0]?.getAttribute('r:id');
  const rels=(await xml('xl/_rels/workbook.xml.rels'))?.getElementsByTagName('Relationship');
  const target=Array.from(rels||[]).find(x=>x.getAttribute('Id')===sheetId)?.getAttribute('Target');
  const sheet=(target?new URL(target,'https://xlsx.local/xl/workbook.xml').pathname.slice(1):'xl/worksheets/sheet1.xml');
  const sheetXml=await xml(sheet);
  if(!sheetXml) throw new Error('Helaian pertama Excel tidak ditemui.');
  const shared=(await xml('xl/sharedStrings.xml'))?.getElementsByTagName('si');
  const innerText=element=>Array.from(element?.getElementsByTagName('t')||[]).map(n=>n.textContent).join('');
  return Array.from(sheetXml.getElementsByTagName('row')).map(row=>{
    const values=[];
    for(const cell of row.getElementsByTagName('c')){
      const letters=cell.getAttribute('r')?.match(/^[A-Z]+/)?.[0]||'A';
      const column=[...letters].reduce((sum,v)=>sum*26+v.charCodeAt(0)-64,0)-1;
      const value=cell.getElementsByTagName('v')[0]?.textContent||'';
      const type=cell.getAttribute('t');
      values[column]=type==='s'?innerText(shared?.[Number(value)]):type==='inlineStr'?innerText(cell.getElementsByTagName('is')[0]):value;
    }
    return values;
  });
}
const nameHeaders=['nama','nama penuh','nama penerima','nama peserta','nama penuh penerima'];
const headerIndex=row=>row.findIndex(cell=>nameHeaders.includes(norm(cell??'')));
export function columnNames(rows){
  const headings=rows.shift()||[];
  const index=headerIndex(headings);
  if(index<0) throw new Error('Letakkan tajuk “Nama” pada baris pertama fail.');
  return rows.map(row=>row[index]??'');
}
function documentNames(rows){
  return rows.map(line=>clean(line).replace(/^\(?\d{1,4}[.)\-:]\s*|^[•●▪–—-]\s+/,''))
    .filter(line=>line&&!nameHeaders.includes(norm(line))&&!/^senarai (?:nama|penerima|peserta)$/i.test(line)&&!/^(?:muka surat|halaman)\s*\d+/i.test(line)&&!/^\d+$/.test(line));
}
async function parseDocx(file){
  const xml=await openOfficeArchive(file);
  const doc=await xml('word/document.xml');
  const body=doc?.getElementsByTagNameNS('*','body')[0];
  if(!body) throw new Error('Dokumen Word tidak dapat dibaca. Gunakan fail .docx.');
  const textOf=el=>Array.from(el.getElementsByTagNameNS('*','t')).map(t=>t.textContent).join('');
  const names=[];
  const paragraphs=[];
  for(const block of body.children){
    if(block.localName==='p') paragraphs.push(textOf(block));
    if(block.localName!=='tbl') continue;
    const rows=Array.from(block.children).filter(row=>row.localName==='tr').map(row=>
      Array.from(row.children).filter(cell=>cell.localName==='tc').map(cell=>
        Array.from(cell.children).filter(part=>part.localName==='p').map(textOf).join(' ')));
    const heading=rows.findIndex(row=>headerIndex(row)>=0);
    if(heading>=0) names.push(...columnNames(rows.slice(heading)));
    else if(rows.every(row=>row.length===1)) names.push(...rows.map(row=>row[0]));
  }
  return documentNames(names.length?names:paragraphs);
}
function pdfRows(items){
  const rows=[];
  for(const item of items){
    if(!item.str?.trim()) continue;
    const [,,,,x,y]=item.transform;
    let row=rows.find(r=>Math.abs(r.y-y)<2.5);
    if(!row){row={y,parts:[]};rows.push(row);}
    row.parts.push({x,end:x+item.width,text:item.str,height:item.height});
  }
  return rows.sort((a,b)=>b.y-a.y).map(row=>{
    const cells=[];
    for(const part of row.parts.sort((a,b)=>a.x-b.x)){
      const last=cells.at(-1);
      if(last&&part.x-last.end<Math.max(7,part.height*.75)){
        last.text+=(part.x-last.end>1?' ':'')+part.text;
        last.end=Math.max(last.end,part.end);
      }else cells.push({...part});
    }
    return cells;
  });
}
async function parsePdf(file){
  const pdfjs=await import('./pdfjs-build/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc=new URL('./pdfjs-build/pdf.worker.min.mjs',location.href).href;
  const task=pdfjs.getDocument({
    data:new Uint8Array(await file.arrayBuffer()),useWasm:false,
    cMapUrl:new URL('./pdfjs-build/cmaps/',location.href).href,cMapPacked:true,
    standardFontDataUrl:new URL('./pdfjs-build/standard_fonts/',location.href).href
  });
  const names=[];
  let column;
  try {
    const pdf=await task.promise;
    if(pdf.numPages>maximumPdfPages) throw new Error('Had import PDF ialah 100 halaman. Muat naik bahagian yang mengandungi senarai nama sahaja.');
    for(let i=1;i<=pdf.numPages;i++){
      const page=await pdf.getPage(i);
      const rows=pdfRows((await page.getTextContent()).items);
      const heading=rows.findIndex(row=>headerIndex(row.map(cell=>cell.text))>=0);
      if(heading>=0){
        const cells=rows[heading];
        const index=headerIndex(cells.map(cell=>cell.text));
        column={start:cells[index].x-8,end:cells[index+1]?.x-8||Infinity};
      }
      for(const row of rows.slice(heading+1)){
        const cells=column?row.filter(c=>c.x>=column.start&&c.x<column.end):row;
        if(!column&&/^\d{1,4}[.)]?$/.test(clean(cells[0]?.text??''))) cells.shift();
        names.push(cells.map(c=>c.text).join(' '));
      }
    }
  } catch(error){
    if(error.name==='PasswordException') throw new Error('Fail PDF dilindungi kata laluan. Gunakan salinan yang boleh dibuka.');
    throw error;
  } finally {await task.destroy();}
  if(!names.some(name=>name.trim())) throw new Error('Tiada teks dikesan dalam PDF. Untuk PDF imbasan, jalankan OCR dahulu atau gunakan Word atau CSV.');
  return documentNames(names);
}
export async function readNames(file){
  if(!file?.size) throw new Error('Pilih PDF, CSV, Word atau Excel yang mengandungi senarai penerima.');
  if(file.size>4000000) throw new Error('Gunakan fail berukuran di bawah 4 MB.');
  const ext=file.name.split('.').pop().toLowerCase();
  let names;
  if(ext==='pdf') names=await parsePdf(file);
  else if(ext==='docx') names=await parseDocx(file);
  else if(ext==='csv') names=columnNames(parseCsv(await file.text()));
  else if(ext==='xlsx') names=columnNames(await parseXlsx(file));
  else throw new Error('Gunakan fail .pdf, .csv, .docx atau .xlsx.');
  names=names.map(clean).filter(Boolean);
  if(!names.length) throw new Error('Tiada nama dikesan. Semak format senarai dalam fail.');
  return names;
}
