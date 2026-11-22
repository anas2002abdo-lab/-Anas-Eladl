import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { doc, getDocFromServer, getFirestore, initializeFirestore, type Firestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

function createResilientFirestore(): Firestore {
  const databaseId = firebaseConfig.firestoreDatabaseId || '(default)';
  try {
    return initializeFirestore(
      app,
      {
        experimentalForceLongPolling: true,
      },
      databaseId
    );
  } catch {
    return getFirestore(app, databaseId);
  }
}

export const firestoreDb = createResilientFirestore();
export const firebaseAuth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export const FIREBASE_PROJECT_ID = firebaseConfig.projectId;
export const FIRESTORE_DATABASE_ID = firebaseConfig.firestoreDatabaseId;

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: firebaseAuth.currentUser?.uid,
      email: firebaseAuth.currentUser?.email,
      emailVerified: firebaseAuth.currentUser?.emailVerified,
      isAnonymous: firebaseAuth.currentUser?.isAnonymous,
      tenantId: firebaseAuth.currentUser?.tenantId,
      providerInfo:
        firebaseAuth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export async function testFirestoreConnection(): Promise<{ ok: boolean; offline?: boolean }> {
  const attempt = async () => {
    await getDocFromServer(doc(firestoreDb, 'test', 'connection'));
  };

  try {
    await attempt();
    return { ok: true };
  } catch (firstError) {
    const firstMsg = firstError instanceof Error ? firstError.message : String(firstError);
    if (!firstMsg.includes('the client is offline') && !firstMsg.includes('unavailable')) {
      return { ok: true };
    }
    // Retry once after a brief delay in case of transient iframe/network handshake delay
    await new Promise((resolve) => setTimeout(resolve, 1500));
    try {
      await attempt();
      return { ok: true };
    } catch (error) {
      if (error instanceof Error && error.message.includes('the client is offline')) {
        console.error('Please check your Firebase configuration.');
        return { ok: false, offline: true };
      }
      return { ok: true };
    }
  }
}

void testFirestoreConnection();
