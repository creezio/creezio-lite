// Isolated browser fixture served by Vite only, outside app/ and public/.
// Uses the actual native components and application CSS, with no auth or API data.
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { AppRouterContext } from 'vinext/shims/internal/app-router-context';
import { GlobalSearchProvider, useGlobalSearch } from '../creezio/packages/shell-ui/ui/search/global-search-provider';
import { configureGlobalSearch } from '../creezio/packages/shell-ui/ui/search/global-search-config';
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogDescription } from '../creezio/packages/shell-ui/ui/primitives/dialog';
import { Button } from '../creezio/packages/shell-ui/ui/primitives/button';
import '../app/globals.css';

if (!AppRouterContext) throw new Error('The UI fixture needs the browser router context.');
const RouterProvider = AppRouterContext.Provider;

configureGlobalSearch({ storageKey:'creezio-ui-check', placeholder:'Rechercher une page…',
  search: async query => [{index:'pages',id:'documents',title:'Documents',href:'/documents'}].filter(hit=>hit.title.toLowerCase().includes(query.toLowerCase())),
});
function Controls(){
  const search=useGlobalSearch();
  return <div className="p-6 flex gap-4">
    <Button onClick={()=>search.setOpen(true)}>Rechercher</Button>
    <Dialog><DialogTrigger asChild><Button>Ouvrir un formulaire</Button></DialogTrigger><DialogContent><DialogTitle>Formulaire Creezio</DialogTitle><DialogDescription>Vérification du centrage de la modale native.</DialogDescription><label>Nom<input className="border rounded p-2 ml-3"/></label></DialogContent></Dialog>
  </div>;
}
function Fixture(){
  const [destination,setDestination]=useState('');
  const router={bfcacheId:'creezio-ui-check',push:setDestination,replace:setDestination,back(){},forward(){},refresh(){},prefetch:async()=>{}};
  return <RouterProvider value={router}><GlobalSearchProvider><Controls/><output aria-label="Page sélectionnée">{destination}</output></GlobalSearchProvider></RouterProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
