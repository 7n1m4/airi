const fs = require('node:fs')
const path = require('node:path')

const { app, BrowserWindow } = require('electron')

const BACKUP_DIR = '/Volumes/AIRI-Backup-Share/db'

app.setPath('userData', '/Users/richardpinedo/Library/Application Support/@proj-airi/stage-tamagotchi')

app.whenReady().then(() => {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  })

  win.loadURL('http://localhost:5173')

  win.webContents.on('did-finish-load', async () => {
    try {
      console.info('Extracting local IndexedDB database records...')
      const localData = await win.webContents.executeJavaScript(`
        (async () => {
          const dbName = "keyval-store";
          const storeName = "keyval";
          
          return new Promise((resolve, reject) => {
            const request = indexedDB.open(dbName);
            request.onsuccess = (event) => {
              const db = event.target.result;
              if (!db.objectStoreNames.contains(storeName)) {
                reject(new Error("Store keyval not found"));
                return;
              }
              const transaction = db.transaction(storeName, "readonly");
              const store = transaction.objectStore(storeName);
              const getAllKeysRequest = store.getAllKeys();
              
              getAllKeysRequest.onsuccess = () => {
                const keys = getAllKeysRequest.result;
                const sessions = {};
                let cards = null;
                let pending = 0;
                
                for (const key of keys) {
                  if (key === 'airi-local:airi-cards') {
                    pending++;
                    const getReq = store.get(key);
                    getReq.onsuccess = () => {
                      cards = getReq.result;
                      pending--;
                      if (pending === 0) resolve({ cards, sessions });
                    };
                  } else if (key.startsWith('airi-local:chat:sessions:')) {
                    pending++;
                    const sessionId = key.replace('airi-local:chat:sessions:', '');
                    const getReq = store.get(key);
                    getReq.onsuccess = () => {
                      sessions[sessionId] = getReq.result;
                      pending--;
                      if (pending === 0) resolve({ cards, sessions });
                    };
                  }
                }
                if (pending === 0) {
                  resolve({ cards, sessions });
                }
              };
            };
            request.onerror = (e) => reject(e);
          });
        })()
      `)

      console.info('Running comparison with remote backup share at:', BACKUP_DIR)
      runComparison(localData)
    }
    catch (e) {
      console.error('Audit failed:', e)
    }
    finally {
      app.quit()
    }
  })
})

function runComparison(local) {
  let issuesFound = 0

  // 1. Audit Cards
  console.info('\n--- 1. AUDITING CHARACTER CARDS ---')
  const remoteCardsPath = path.join(BACKUP_DIR, 'airi-cards.json')
  if (fs.existsSync(remoteCardsPath)) {
    const remoteCards = JSON.parse(fs.readFileSync(remoteCardsPath, 'utf8'))
    const localCardsMap = new Map(Array.isArray(local.cards) ? local.cards : Object.entries(local.cards || {}))
    const remoteCardsMap = new Map(Array.isArray(remoteCards) ? remoteCards : Object.entries(remoteCards))

    console.info(`Local Cards count: ${localCardsMap.size}, Backup Cards count: ${remoteCardsMap.size}`)

    // Check for local-only modifications
    for (const [id, localCard] of localCardsMap.entries()) {
      const remoteCard = remoteCardsMap.get(id)
      if (!remoteCard) {
        console.warn(`[NEW LOCAL CARD] Card "${localCard.name}" (${id}) exists locally but is missing in the backup!`)
        issuesFound++
      }
      else {
        const localTime = localCard.updatedAt || localCard.createdAt || 0
        const remoteTime = remoteCard.updatedAt || remoteCard.createdAt || 0
        if (localTime > remoteTime) {
          console.warn(`[UNSYNCED CARD CHANGE] Card "${localCard.name}" (${id}) is newer locally (Local: ${localTime}, Remote: ${remoteTime})`)
          issuesFound++
        }
      }
    }
  }
  else {
    console.warn(`[WARNING] Remote cards backup file does not exist at ${remoteCardsPath}`)
    issuesFound++
  }

  // 2. Audit Chat Sessions
  console.info('\n--- 2. AUDITING CHAT SESSIONS ---')
  const remoteSessionsDir = path.join(BACKUP_DIR, 'chat', 'sessions')
  const localSessions = local.sessions || {}
  const localSessionIds = Object.keys(localSessions)
  console.info(`Local Chat Sessions count: ${localSessionIds.length}`)

  if (fs.existsSync(remoteSessionsDir)) {
    const remoteSessionFiles = fs.readdirSync(remoteSessionsDir).filter(f => f.endsWith('.json'))
    const remoteSessionIds = new Set(remoteSessionFiles.map(f => f.replace('.json', '')))
    console.info(`Backup Chat Sessions count: ${remoteSessionIds.size}`)

    for (const id of localSessionIds) {
      const localSess = localSessions[id]
      if (!localSess)
        continue

      if (!remoteSessionIds.has(id)) {
        console.warn(`[NEW LOCAL CHAT] Session "${localSess.title || 'Untitled'}" (${id}) exists locally but is missing in backup!`)
        issuesFound++
      }
      else {
        const remoteSessPath = path.join(remoteSessionsDir, `${id}.json`)
        const remoteSess = JSON.parse(fs.readFileSync(remoteSessPath, 'utf8'))

        const localTime = localSess.updatedAt || localSess.createdAt || 0
        const remoteTime = remoteSess.updatedAt || remoteSess.createdAt || 0

        if (localTime > remoteTime) {
          console.warn(`[UNSYNCED CHAT CHANGE] Session "${localSess.title || 'Untitled'}" (${id}) is newer locally (Local: ${localTime}, Remote: ${remoteTime})`)
          issuesFound++
        }
      }
    }
  }
  else {
    console.warn(`[WARNING] Remote sessions directory does not exist at ${remoteSessionsDir}`)
    issuesFound++
  }

  console.info('\n--- AUDIT COMPLETE ---')
  if (issuesFound === 0) {
    console.info('🎉 SUCCESS: Your local cards and chat history are 100% in sync with the backup share!')
    console.info('You can safely clear IndexedDB site storage; no user data will be lost.')
  }
  else {
    console.info(`⚠️ WARNING: Found ${issuesFound} unsynced differences between local DB and backup share.`)
    console.info('Do not clear IndexedDB until these differences are reconciled.')
  }
}
