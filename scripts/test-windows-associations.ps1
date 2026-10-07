# Installs disposable CI builds. Run only on an isolated Windows test machine.
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true') {
  throw 'This installer test is restricted to disposable GitHub Actions runners.'
}

function Assert-Associations {
  foreach ($extension in @('md', 'markdown', 'mdown', 'mkd')) {
    $key = Get-Item "Registry::HKEY_CLASSES_ROOT\.$extension"
    $class = $key.GetValue('')
    if ($class -ne 'mdReader.Markdown') { throw "Missing mdReader association for .$extension ($class)" }
    $command = (Get-Item "Registry::HKEY_CLASSES_ROOT\$class\shell\open\command").GetValue('')
    if ($command -notmatch '^"([^"]+\.exe)"\s+"%1"$') { throw "Unquoted or invalid open command: $command" }
    if (!(Test-Path -LiteralPath $Matches[1])) { throw "Associated application does not exist: $command" }
    Write-Host "Verified .$extension registration and quoted executable/document paths."
  }
}

function Run-Installer($path, $arguments) {
  $process = Start-Process -FilePath $path -ArgumentList $arguments -Wait -PassThru
  if ($process.ExitCode -notin @(0, 3010)) { throw "Installer failed with exit code $($process.ExitCode): $path" }
}

$bundleRoot = Join-Path $PSScriptRoot '../src-tauri/target/release/bundle'
$nsis = @(Get-ChildItem "$bundleRoot/nsis/*-setup.exe")
$msi = @(Get-ChildItem "$bundleRoot/msi/*.msi")
if ($nsis.Count -ne 1 -or $msi.Count -ne 1) { throw 'Expected one EXE and one MSI installer.' }
$installDir = Join-Path $env:RUNNER_TEMP 'mdReader association test'
$newUserExtensionKeys = @('md', 'markdown', 'mdown', 'mkd') | ForEach-Object {
  $key = "HKCU:\Software\Classes\.$_"
  if (!(Test-Path $key)) { $key }
}
Run-Installer $nsis[0].FullName "/S /D=$installDir"
try { Assert-Associations }
finally {
  Run-Installer (Join-Path $installDir 'uninstall.exe') '/S'
  # NSIS can leave an empty extension value after uninstall. Remove only keys
  # introduced by this test so they cannot shadow the MSI's machine registration.
  foreach ($key in $newUserExtensionKeys) {
    if (Test-Path $key) { Remove-Item $key -Recurse }
  }
}

Run-Installer 'msiexec.exe' "/i `"$($msi[0].FullName)`" /qn /norestart"
try { Assert-Associations }
finally { Run-Installer 'msiexec.exe' "/x `"$($msi[0].FullName)`" /qn /norestart" }
