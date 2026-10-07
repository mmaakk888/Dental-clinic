import express from 'express';
import path from 'node:path';
import { existsSync } from 'node:fs';

const fingerprintedAsset = /^\/assets\/[\w-]+-[\w-]{8,}\.(?:js|css)$/;

export function mountStaticAssets(app: express.Express, distPath: string): void {
  app.use((req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method) || !fingerprintedAsset.test(req.path)) return next();
    // Vary applies to both compressed and identity responses, including 304s.
    res.vary('Accept-Encoding');
    const encoding = req.acceptsEncodings('br', 'gzip', 'identity');
    if (encoding !== 'br' && encoding !== 'gzip') return next();
    const relative = `${req.path.slice(1)}.${encoding === 'br' ? 'br' : 'gz'}`;
    if (!existsSync(path.join(distPath, relative))) return next();
    res.type(path.extname(req.path));
    res.setHeader('Content-Encoding', encoding);
    res.sendFile(relative, { root: distPath, dotfiles: 'deny', maxAge: '1y', immutable: true }, error => {
      if (error) next(error);
    });
  });
  app.use(express.static(distPath, {
    dotfiles: 'deny', index: 'index.html',
    setHeaders(res, file) {
      const relative = `/${path.relative(distPath, file).split(path.sep).join('/')}`;
      res.setHeader('Cache-Control', fingerprintedAsset.test(relative)
        ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  }));
  app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(path.join(distPath, 'index.html'));
  });
}
