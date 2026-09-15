import { getChatGPTUser } from './chatgpt-auth';
import { appDefinition } from './app-definition';
import { LiteWorkspace } from '@/creezio/ui/workspace';
import { SignInButton } from './sign-in-button';
export const dynamic = 'force-dynamic';
export default async function Home() {
  const user = await getChatGPTUser();
  if (!user) return <main className="login-page"><div className="login-brand"><span className="brand-mark">{appDefinition.name.charAt(0).toUpperCase()}</span><h1>{appDefinition.name}</h1><p>{appDefinition.description}</p></div><div className="login-card"><span className="eyebrow">VOTRE ESPACE DE TRAVAIL</span><h2>Bienvenue</h2><p>Connectez-vous pour retrouver vos données et travailler avec votre équipe.</p><SignInButton/><small>Votre compte identifie vos accès à cette application.</small></div></main>;
  return <LiteWorkspace app={appDefinition} user={user}/>;
}
