param([string]$OutputName = '聚梦传媒小程序-源码.zip')
$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$deliveryRoot = Join-Path $projectRoot 'delivery'
[System.IO.Directory]::CreateDirectory($deliveryRoot) | Out-Null
$archivePath = Join-Path $deliveryRoot $OutputName
$rootFiles = @('package.json','package-lock.json','project.config.json','tsconfig.mini.json','tsconfig.server.json','README.md','UI_HANDOFF.md','AGENTS.md','CLAUDE.md','NEXT_AI_HANDOFF.md','Dockerfile','.dockerignore','.gitignore')
$stream = [System.IO.File]::Open($archivePath, [System.IO.FileMode]::CreateNew)
$archive = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Create)
$count = 0
try {
    foreach ($item in Get-ChildItem -LiteralPath $projectRoot -Recurse -File) {
        $relative = [System.IO.Path]::GetRelativePath($projectRoot, $item.FullName).Replace('\', '/')
        $include = ($rootFiles -contains $relative) -or ($relative -match '^(miniprogram|server|scripts|tests|docs|dist|brand|\.github)/')
        if (-not $include) { continue }
        if ($relative -match '^server/(data/|\.env$)' -or $relative -match '\.sqlite($|-)' -or $relative -match '(^|/)\.env$') { continue }
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $item.FullName, $relative, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
        $count++
    }
} finally {
    $archive.Dispose()
    $stream.Dispose()
}
Write-Output "源码包已生成：$archivePath（$count 个文件；无node_modules、密钥、聊天数据库或原视频）"
