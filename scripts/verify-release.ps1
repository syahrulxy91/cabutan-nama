[CmdletBinding()]
param(
    [Parameter(Mandatory)] [ValidatePattern('^[a-f0-9]{40}$')] [string] $Commit
)

$ErrorActionPreference = 'Stop'
function Invoke-Checked([string] $Program, [string[]] $Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Program exited with code $LASTEXITCODE" }
}

Push-Location (Split-Path -Parent $PSScriptRoot)
try {
    $head = Invoke-Checked git @('rev-parse', 'HEAD')
    if ($head -ne $Commit) { throw "Expected $Commit but found $head" }
    if (Invoke-Checked git @('status', '--porcelain')) { throw 'Use a clean checkout.' }
    Invoke-Checked node @('--version')
    Invoke-Checked npm @('--version')
    Invoke-Checked npx @('-y', 'firebase-tools@15.36.0', '--version')
    Invoke-Checked npm @('ci')
    Invoke-Checked npm @('ci', '--prefix', 'functions')
    Invoke-Checked npm @('test')
    Invoke-Checked npm @('run', 'build')
    Invoke-Checked npm @('run', 'test:integration')
    Get-FileHash -Algorithm SHA256 -LiteralPath @(
        'dist/index.html', 'dist/app.js', 'dist/style.css',
        'dist/firebase.js', 'dist/office.mjs', 'dist/qr.js'
    )
} finally {
    Pop-Location
}
