# ana-gmail / ana-drive を Claude Code のユーザースキルとして使えるようにする（何度実行しても安全）
# - スキル置き場（$env:CLAUDE_CONFIG_DIR\skills、未設定なら ~\.claude\skills）にこのリポジトリへのジャンクションを張る
# - 設定ファイル ~\workspace\.ana\bridge.json が無ければ雛形をコピーする（中身は自分で書く）
$ErrorActionPreference = 'Stop'
$repo = $PSScriptRoot
$configDir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $env:USERPROFILE '.claude' }
$skillsDir = Join-Path $configDir 'skills'
New-Item -ItemType Directory -Force $skillsDir | Out-Null

foreach ($name in 'ana-gmail', 'ana-drive') {
  $link = Join-Path $skillsDir $name
  $target = Join-Path $repo "skills\$name"
  $item = Get-Item $link -ErrorAction SilentlyContinue
  if ($item -and -not $item.LinkType) {
    Write-Warning "$link は通常のフォルダです。中身を確かめて自分で退避してから、もう一度実行してください（このスクリプトは消しません）"
    continue
  }
  if ($item) { $item.Delete() }  # ジャンクション自体だけを外す（リンク先は消えない）
  New-Item -ItemType Junction -Path $link -Target $target | Out-Null
  Write-Host "linked: $name"
}

$conf = Join-Path $env:USERPROFILE 'workspace\.ana\bridge.json'
if (-not (Test-Path $conf)) {
  New-Item -ItemType Directory -Force (Split-Path $conf) | Out-Null
  Copy-Item (Join-Path $repo 'config\bridge.example.json') $conf
  Write-Host "created: $conf（README の手順 3 で中身を書いてください）"
} else {
  Write-Host "exists: $conf"
}
