$ErrorActionPreference = "Stop"

$api = "http://localhost:8001/api/v1"
$tmp = "C:\Users\joses\Documents\Proyecto_Desarrollo\ETL_V1\apps\api\sample.csv"
"invoice_number,vendor_name,total`nFAC-001,Proveedor A,1000" | Out-File -Encoding utf8 $tmp

$regA = @{
    email = "admin.a@tenant-a.com"
    password = "Admin1234"
    full_name = "Admin A"
    tenant_slug = "tenant-a"
    tenant_name = "Tenant A"
} | ConvertTo-Json

$regB = @{
    email = "admin.b@tenant-b.com"
    password = "Admin1234"
    full_name = "Admin B"
    tenant_slug = "tenant-b"
    tenant_name = "Tenant B"
} | ConvertTo-Json

try {
    Invoke-RestMethod -Method Post -Uri "$api/auth/register" -ContentType "application/json" -Body $regA | Out-Null
} catch {
    # Puede existir de una corrida previa
}

try {
    Invoke-RestMethod -Method Post -Uri "$api/auth/register" -ContentType "application/json" -Body $regB | Out-Null
} catch {
    # Puede existir de una corrida previa
}

$loginA = Invoke-RestMethod -Method Post -Uri "$api/auth/login" -ContentType "application/json" -Body (@{
    email = "admin.a@tenant-a.com"
    password = "Admin1234"
} | ConvertTo-Json)

$loginB = Invoke-RestMethod -Method Post -Uri "$api/auth/login" -ContentType "application/json" -Body (@{
    email = "admin.b@tenant-b.com"
    password = "Admin1234"
} | ConvertTo-Json)

$hA = @{ Authorization = "Bearer $($loginA.access_token)" }
$hB = @{ Authorization = "Bearer $($loginB.access_token)" }

$meA = Invoke-RestMethod -Method Get -Uri "$api/auth/me" -Headers $hA
$meB = Invoke-RestMethod -Method Get -Uri "$api/auth/me" -Headers $hB

$upAJson = curl.exe -s -X POST "$api/invoices/batches" -H "Authorization: Bearer $($loginA.access_token)" -F "file=@$tmp;type=text/csv"
$upBJson = curl.exe -s -X POST "$api/invoices/batches" -H "Authorization: Bearer $($loginB.access_token)" -F "file=@$tmp;type=text/csv"
$upA = $upAJson | ConvertFrom-Json
$upB = $upBJson | ConvertFrom-Json

$listA = Invoke-RestMethod -Method Get -Uri "$api/invoices/batches?page=1&page_size=50" -Headers $hA
$listB = Invoke-RestMethod -Method Get -Uri "$api/invoices/batches?page=1&page_size=50" -Headers $hB

$cross = "OK"
try {
    Invoke-RestMethod -Method Get -Uri "$api/invoices/batches/$($upB.id)" -Headers $hA | Out-Null
    $cross = "FALLO: tenant A pudo ver batch de tenant B"
} catch {
    $cross = "OK: tenant A NO puede ver batch de tenant B"
}

"TENANT_A=$($meA.tenant_id) EMAIL_A=$($meA.email)"
"TENANT_B=$($meB.tenant_id) EMAIL_B=$($meB.email)"
"BATCH_A=$($upA.id)"
"BATCH_B=$($upB.id)"
"LIST_A_TOTAL=$($listA.total) IDS=$([string]::Join(',', ($listA.items | ForEach-Object { $_.id })))"
"LIST_B_TOTAL=$($listB.total) IDS=$([string]::Join(',', ($listB.items | ForEach-Object { $_.id })))"
"CROSS_ACCESS=$cross"
