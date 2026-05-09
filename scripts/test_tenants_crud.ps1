$ErrorActionPreference = "Stop"
$api = "http://localhost:8001/api/v1"

$loginA = Invoke-RestMethod -Method Post -Uri "$api/auth/login" -ContentType "application/json" -Body (@{
    email = "admin.a@tenant-a.com"
    password = "Admin1234"
} | ConvertTo-Json)

$token = $loginA.access_token
$hJson = @{
    Authorization = "Bearer $token"
    "Content-Type" = "application/json"
}
$hAuth = @{ Authorization = "Bearer $token" }

$tenant = Invoke-RestMethod -Method Post -Uri "$api/tenants" -Headers $hJson -Body (@{
    name = "Cliente Demo"
    tax_id = "900123456-7"
} | ConvertTo-Json)

$list = Invoke-RestMethod -Method Get -Uri "$api/tenants" -Headers $hAuth
$get = Invoke-RestMethod -Method Get -Uri "$api/tenants/$($tenant.id)" -Headers $hAuth
$patch = Invoke-RestMethod -Method Patch -Uri "$api/tenants/$($tenant.id)" -Headers $hAuth
$del = Invoke-RestMethod -Method Delete -Uri "$api/tenants/$($tenant.id)" -Headers $hAuth

"TENANT_CREATED_ID=$($tenant.id)"
"TENANTS_LIST_COUNT=$($list.Count)"
"TENANT_GET_STATUS=$($get.status)"
"TENANT_PATCH_UPDATED=$($patch.updated)"
"TENANT_DELETE=$($del.deleted)"
