export async function openOfficeArchive(file){
  const bytes=new Uint8Array(await file.arrayBuffer());
  const view=new DataView(bytes.buffer);
  const decoder=new TextDecoder();
  const u16=i=>view.getUint16(i,true),u32=i=>view.getUint32(i,true);
  const invalid=()=>new Error('Fail Word atau Excel tidak dapat dibaca. Eksport semula fail dan cuba lagi.');
  const tooLarge=()=>new Error('Kandungan dokumen terlalu besar. Pecahkan fail dan cuba lagi.');
  const entryLimit=12500000;
  const archiveLimit=25000000;
  let end=bytes.length-22;
  while(end>=Math.max(0,bytes.length-65557)&&u32(end)!==0x06054b50) end--;
  if(end<Math.max(0,bytes.length-65557)) throw new Error('Fail Word atau Excel tidak dapat dibaca.');
  const directory=new Map();
  let ptr=u32(end+16);
  const directoryEnd=ptr+u32(end+12);
  if(directoryEnd>end||u16(end+10)>4096) throw invalid();
  for(let i=0;i<u16(end+10);i++){
    if(ptr+46>directoryEnd||u32(ptr)!==0x02014b50) throw invalid();
    const nameLength=u16(ptr+28),name=decoder.decode(bytes.subarray(ptr+46,ptr+46+nameLength));
    const next=ptr+46+nameLength+u16(ptr+30)+u16(ptr+32);
    if(next>directoryEnd||directory.has(name)) throw invalid();
    directory.set(name,{method:u16(ptr+10),size:u32(ptr+20),raw:u32(ptr+24),start:u32(ptr+42)});
    ptr=next;
  }
  if(ptr!==directoryEnd) throw invalid();
  const dataEnd=u32(end+16);
  let total=0;
  async function xml(name){
    const f=directory.get(name);
    if(!f) return null;
    if(f.raw>entryLimit||total+f.raw>archiveLimit) throw tooLarge();
    if(f.start+30>dataEnd||u32(f.start)!==0x04034b50||u16(f.start+8)!==f.method) throw invalid();
    const start=f.start+30+u16(f.start+26)+u16(f.start+28);
    if(start+f.size>dataEnd) throw invalid();
    const content=bytes.subarray(start,start+f.size);
    let source;
    if(f.method===0){
      if(content.length!==f.raw) throw invalid();
      total+=content.length;
      source=decoder.decode(content);
    }else if(f.method===8){
      const reader=new Blob([content]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
      const xmlDecoder=new TextDecoder();
      const parts=[];
      let count=0;
      try{
        for(;;){
          const {done,value}=await reader.read();
          if(done) break;
          count+=value.byteLength;
          if(count>entryLimit||total+count>archiveLimit) throw tooLarge();
          if(count>f.raw) throw invalid();
          parts.push(xmlDecoder.decode(value,{stream:true}));
        }
        if(count!==f.raw) throw invalid();
      }catch(error){
        await reader.cancel().catch(()=>{});
        throw error;
      }finally{reader.releaseLock();}
      total+=count;
      parts.push(xmlDecoder.decode());
      source=parts.join('');
    }
    else throw new Error('Jenis mampatan dokumen tidak disokong.');
    const document=new DOMParser().parseFromString(source,'application/xml');
    if(document.querySelector('parsererror')) throw new Error('Kandungan dokumen tidak dapat dibaca.');
    return document;
  }
  return xml;
}
