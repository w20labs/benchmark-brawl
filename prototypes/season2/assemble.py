import base64, json, pathlib
here = pathlib.Path(__file__).parent
imgs = {p.stem: 'data:image/jpeg;base64,' + base64.b64encode(p.read_bytes()).decode() for p in sorted((here / 'web').glob('*.jpg'))}
t = (here / 'mock.template.html').read_text()
t = t.replace('__DATA__', (here / 'mock-data.json').read_text()).replace('__IMGS__', json.dumps(imgs))
(here / 'overfit-fc-mock.html').write_text(t)
print(len(t) // 1024, 'KB')
