# Adds a tiny, synchronous, non-module inline script as the very first
# thing inside <head> on every page except login.html — this is what
# actually closes the flash-of-content gap, since it runs immediately as
# the parser hits it, before the deferred auth.js module even starts.
# Safe to re-run: skips any file that already has it.

$files = Get-ChildItem -Path ".\pages\*.html", ".\index.html" -ErrorAction SilentlyContinue

foreach ($file in $files) {
    if ($file.Name -eq "login.html") {
        Write-Host "Skipped (login page, must stay visible without auth.js's reveal): $($file.Name)"
        continue
    }

    $content = Get-Content $file.FullName -Raw

    if ($content -match 'documentElement\.style\.visibility') {
        Write-Host "Skipped (already has it): $($file.Name)"
        continue
    }

    $snippet = "<script>document.documentElement.style.visibility = `"hidden`";</script>`n  "
    $newContent = $content -replace '(<head>)', "`$1`n  $snippet"

    if ($newContent -eq $content) {
        Write-Host "WARNING: could not find <head> tag in $($file.Name) - skipped, check it manually"
        continue
    }

    Set-Content -Path $file.FullName -Value $newContent -NoNewline
    Write-Host "Updated: $($file.Name)"
}

Write-Host "`nDone. Review with 'git diff' before committing, same as always."
