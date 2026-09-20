export async function readBrowserSessionResponse(res:Response) {
  const json=/\bapplication\/(?:[a-z0-9.-]+\+)?json\b/i.test(res.headers.get('content-type')??'');
  const data:unknown=json?await res.json().catch(()=>null):null;
  const record=data&&typeof data==='object'?data as Record<string,unknown>:null;
  if(!res.ok) {
    const detail=record?.error;
    const message=detail&&typeof detail==='object'&&typeof (detail as {message?:unknown}).message==='string'?(detail as {message:string}).message:null;
    throw Object.assign(new Error(message??(res.status===401?'Votre session a expiré. Reconnectez-vous.':res.status===409?'Cette fenêtre n’est plus active. Reprenez la main pour continuer.':'Connexion momentanément indisponible.')), {status:res.status});
  }
  if(!record||typeof record.active!=='boolean'||![null,'desktop','controller'].includes(record.kind as string|null)||typeof record.desktopConnected!=='boolean') {
    throw Object.assign(new Error('Réponse de connexion invalide. Réessayez dans quelques secondes.'),{status:502});
  }
  if((record.leaseUntil!==null&&record.leaseUntil!==undefined&&typeof record.leaseUntil!=='string')||(record.releaseToken!==null&&record.releaseToken!==undefined&&typeof record.releaseToken!=='string'))throw Object.assign(new Error('Réponse de connexion invalide. Réessayez dans quelques secondes.'),{status:502});
  return record as {active:boolean;kind:'desktop'|'controller'|null;desktopConnected:boolean;workspaceId?:string;leaseUntil?:string|null;releaseToken?:string|null;actions?:unknown[]};
}
