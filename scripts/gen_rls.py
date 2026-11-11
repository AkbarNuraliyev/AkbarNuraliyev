"""Generate the row-level-security migration from the init migration.
Every table that has a "tenantId" column gets RLS enabled + forced and a
tenant_isolation policy. The tenants table itself is scoped by id."""
import re, glob, os
init = sorted(glob.glob('prisma/migrations/*_init/migration.sql'))[0]
sql = open(init).read()
tables = re.findall(r'CREATE TABLE "(\w+)" \((.*?)\n\);', sql, re.S)
out = ['-- Row-level security: tenant isolation enforced by PostgreSQL itself.',
       '-- The application sets app.tenant_id (transaction-local) for every tenant request;',
       '-- app.bypass_rls is only set by audited platform/system code paths (auth, super admin, seed).',
       '']
cond_t = "(current_setting('app.bypass_rls', true) = 'on' OR \"tenantId\" = current_setting('app.tenant_id', true))"
cond_id = "(current_setting('app.bypass_rls', true) = 'on' OR \"id\" = current_setting('app.tenant_id', true))"
n=0
for name, body in tables:
    if name == 'tenants':
        cond = cond_id
    elif '"tenantId"' in body:
        cond = cond_t
    else:
        continue
    n+=1
    out.append(f'ALTER TABLE "{name}" ENABLE ROW LEVEL SECURITY;')
    out.append(f'ALTER TABLE "{name}" FORCE ROW LEVEL SECURITY;')
    out.append(f'CREATE POLICY tenant_isolation ON "{name}" USING {cond} WITH CHECK {cond};')
    out.append('')
ts = os.path.basename(os.path.dirname(init)).split('_')[0]
d = f'prisma/migrations/{int(ts)+1}_row_level_security'
os.makedirs(d, exist_ok=True)
open(d+'/migration.sql','w').write('\n'.join(out))
print('RLS tables:', n)
