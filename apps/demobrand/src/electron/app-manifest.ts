import type { AppManifest } from "@creezio/brand-config";

/**
 * AppManifest généré par `creezio new-app` (Phase D).
 * Ne pas recycler les GUID / feeds des marques prod.
 */
export const demobrandManifest: AppManifest = {
  "brandId": "demobrand",
  "envPrefix": "DEMOBRAND",
  "bridgeName": "demobrandDesktop",
  "dbFileName": "demobrand.db",
  "localConfigFileName": "demobrand-config.json",
  "deepLinkProtocol": "demobrand",
  "sessionPartition": "demobrand-app",
  "logBasename": "demobrand-main",
  "tunnelRootDomain": "demobrand.creez.io",
  "domains": {
    "primary": "demobrand.creez.io",
    "feedHost": "demobrand.creez.io"
  },
  "copyright": "© DemoBrand",
  "client": {
    "appId": "io.creezio.demobrand",
    "productName": "DemoBrand",
    "executableName": "DemoBrand",
    "artifactName": "DemoBrand-Setup-${version}.${ext}",
    "packageName": "demobrand",
    "userDataSegment": "demobrand",
    "feedUrl": "https://demobrand.creez.io/dl-sandboxfac47b3ec4fb510facba4f6f/",
    "nsisGuid": "7673ac29-e40f-5262-b420-5fa6b09cb1bf",
    "appUserModelId": "io.creezio.demobrand"
  },
  "server": {
    "appId": "io.creezio.demobrand.server",
    "productName": "DemoBrand Server",
    "executableName": "DemoBrand-Server",
    "artifactName": "DemoBrand-Server-Setup-${version}.${ext}",
    "packageName": "demobrand-server",
    "userDataSegment": "DemoBrand Server",
    "feedUrl": "https://demobrand.creez.io/dl-sandboxfac47b3ec4fb510facba4f6f/server/",
    "nsisGuid": "30fe0aad-125c-5bdb-9a59-61ff33b07cd7",
    "appUserModelId": "io.creezio.demobrand.server"
  },
  "publish": {
    "dockerDlName": "dl-demobrand",
    "hostDlDirDefault": "/var/lib/docker/volumes/nginx-proxy-manager_npm_data/_data/dl-demobrand",
    "npmContainer": "nginx-proxy-manager",
    "remoteBuildHost": "deploy@104.168.10.36",
    "remoteBuildRoot": "/opt/docker/demobrand-build",
    "remoteBinSrc": "/opt/docker/creezio/apps/demobrand",
    "statusFile": "/tmp/demobrand-build-status.json",
    "remoteLogPrefix": "demobrand-remote-build",
    "buildServerArtifact": true,
    "defaultAppRoot": "/opt/docker/creezio/apps/demobrand"
  },
  "sandbox": true
} as AppManifest;
