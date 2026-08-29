import glob, os, re

js_files = glob.glob('js/**/*.js', recursive=True)
all_ok = True
for f in js_files:
    with open(f, 'r', encoding='utf-8') as fp:
        content = fp.read()
    imports = re.findall(r'from\s+[\'\"](\.[^\'\"]+)[\'\"]', content)
    base_dir = os.path.dirname(f)
    for imp in imports:
        target = os.path.normpath(os.path.join(base_dir, imp))
        if not os.path.exists(target):
            print(f'ERROR in {f}: import target {target} not found!')
            all_ok = False
        else:
            print(f'OK: {f} -> {imp}')

if all_ok:
    print('SUCCESS: All JS module imports are valid!')
