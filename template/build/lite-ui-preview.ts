import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

/** Browser component checks only; this middleware does not exist in a build. */
export function liteUiPreview(): Plugin {
  return { name:'lite-ui-preview', enforce:'pre', apply:'serve',
    configureServer(server){
      server.middlewares.use(async(req,res,next)=>{
        const path=req.url?.split('?')[0];
        if(path!=='/__lite-ui-check'&&path!=='/__lite-ui-check/frame')return next();
        try{
          const file=path.endsWith('/frame')?'ui-check-frame.html':'ui-check.html';
          const html=await readFile(resolve(server.config.root,'tests',file),'utf8');
          res.setHeader('Content-Type','text/html; charset=utf-8');
          res.end(await server.transformIndexHtml(path,html));
        }catch(error){next(error as Error);}
      });
    },
  };
}
