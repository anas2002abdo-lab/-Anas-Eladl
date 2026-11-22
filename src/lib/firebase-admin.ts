import { initializeApp, getApps, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const ADMIN_APP_NAME = 'otlobha-cloudsql-auth';

function getOrInitAdminApp(): App {
  const existing = getApps().find((a) => a.name === ADMIN_APP_NAME);
  if (existing) return existing;
  if (getApps().length === 0) {
    return initializeApp({
      projectId: firebaseConfig.projectId,
    });
  }
  return initializeApp(
    {
      projectId: firebaseConfig.projectId,
    },
    ADMIN_APP_NAME
  );
}

const adminApp = getOrInitAdminApp();
export const adminAuth = getAuth(adminApp);
