/**
 * Types partagés du backend flotte — miroir STRICT des formats d'état sur
 * disque existants (aucun changement de schéma au portage TS) :
 *   - {brandRoot}/docker-data/servers.json          (registre instances)
 *   - {adminRoot}/docker-data/fleet-hosts.json      (hôtes enrôlés + tokens)
 *   - {brandRoot}/docker-data/host-agent.json       (state agent hôte)
 */

/** Instance du registre servers.json (conventions `creezio server-docker`). */
export interface ServerInstance {
  name: string;
  containerName: string;
  port: number;
  bind?: string | null;
  dataDir: string;
  createdAt?: string | null;
  env?: Record<string, string>;
  /** Image per-instance (posée après update) — sinon image de la marque. */
  image?: string;
  variant?: string;
  /** true = stack compose autonome (modèle M2/0.10). */
  stack?: boolean;
  /** Stack : port hôte loopback persisté (>0) — réutilisé à l'update. */
  hostPort?: number;
}

export interface ServerRegistry {
  version: 1;
  brandId: string;
  image: string;
  instances: ServerInstance[];
}

/** Inspect docker léger d'une instance. */
export interface DockerStateLight {
  state: string;
  health: string | null;
  startedAt: string | null;
  image: string | null;
}

export interface BootStatusLight {
  booting: boolean;
  headline: string | null;
  overallPercent: number | null;
  bootStartedAt: string | null;
}

/** Ligne de la vue serveurs (admin/agent GET /servers). */
export interface CollectedServer {
  brandId: string | null;
  brandRoot: string | null;
  name: string;
  containerName: string;
  port: number | null;
  bind: string | null;
  dataDir: string | null;
  createdAt: string | null;
  env: Record<string, string>;
  image: string | null;
  version: string | null;
  orphan: boolean;
  docker: DockerStateLight;
  bootStatus: BootStatusLight | null;
}

export interface BackupResult {
  ok: boolean;
  file: string | null;
  detail: string;
}

export interface UpdateResult {
  ok: boolean;
  error?: string;
  image: string;
  previousImage: string;
  version?: string | null;
  rolledBack?: boolean;
  /** Nom de fichier du backup frais (opt-in), null sinon. */
  backup: string | null;
  steps: string[];
}

/** Suivi asynchrone d'un update (mutex par containerName). */
export interface UpdateEntry {
  status: "running" | "done" | "error";
  image: string;
  startedAt: string;
  finishedAt?: string;
  result?: UpdateResult | { ok: false; error: string; rolledBack?: boolean };
  /** "pull" quand l'update vient de la boucle fleet-releases. */
  source?: string;
  /**
   * Champ ADDITIF (protocole v1 intact) : dernière étape connue de
   * updateServer, persistée au fil de l'eau (update-status-store).
   */
  lastStep?: string;
  /**
   * Champ ADDITIF : true si le process (agent/admin) a redémarré pendant cet
   * update — le statut terminal a été résolu au reload (registre) ou, à
   * défaut, marqué "error" avec issue réelle inconnue.
   */
  agentRestarted?: boolean;
}

/** Hôte enrôlé (fleet-hosts.json runtime — agentToken en clair, 0600). */
export interface FleetHost {
  hostId: string;
  label: string;
  agentUrl: string;
  agentToken: string;
  enrolledAt: string;
  lastSeen?: string | null;
}

/** Token d'enrôlement one-shot (hashé, consommé à l'enroll). */
export interface FleetEnrollToken {
  id: string;
  hash: string;
  label: string | null;
  createdAt: string;
  usedAt?: string | null;
}

export interface FleetHostsFile {
  version: 1;
  hosts: FleetHost[];
  enrollTokens: FleetEnrollToken[];
}

/** State de l'agent hôte (docker-data/host-agent.json, tokens hashés). */
export interface HostAgentState {
  version: 1;
  hostId: string | null;
  label: string | null;
  tokens: Array<{ id?: string; hash: string; revokedAt?: string | null }>;
  adminUrl?: string | null;
  /**
   * URL publique canonique du host-agent (tunnel dédié
   * `https://agent-{slug}.{zone}` / celle réellement provisionnée).
   * Champ ADDITIF — posé par `enroll` et `agent up` (plus l'URL nested
   * partagée `https://agent.{slug}.{zone}`).
   */
  agentUrl?: string | null;
  /** F5 : app admin (updates en pull) + credential flotte, posés par enroll. */
  adminAppUrl?: string | null;
  fleetKey?: string | null;
  /**
   * T7 (champ ADDITIF) : tunnel cloudflared DÉDIÉ agent, posé par enroll.
   * Le token du connecteur vit dans `docker-data/agent-tunnel.env` (600),
   * jamais ici.
   */
  agentTunnel?: {
    tunnelId: string;
    hostname: string;
    container?: string;
    provisionedAt?: string;
  } | null;
}

/** Réponse JSON générique {status, json} des fetch flotte. */
export interface JsonResponse {
  status: number;
  json: unknown;
}

export type AuditFn = (line: string) => void;
