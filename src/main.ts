import './style.css'
import { Capacitor } from '@capacitor/core'
import { Camera, CameraResultType, CameraSource } from '@capacitor/camera'
import { Geolocation } from '@capacitor/geolocation'

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <header class="header">
    <div class="brand">VKU</div>
    <div>
      <h1>Field Survey</h1>
      <p>Khảo sát cơ sở vật chất</p>
    </div>
    <span id="network-status" class="status">Đang kiểm tra...</span>
  </header>

  <main>
    <section class="intro">
      <p class="eyebrow">CÔNG TÁC KIỂM TRA</p>
      <h2>Tạo phiếu khảo sát</h2>
      <p>Ghi nhận tình trạng cơ sở vật chất tại khuôn viên VKU.</p>
    </section>

    <form id="survey-form" class="survey-card">
      <label>
        Tòa nhà
        <input name="building" required placeholder="Ví dụ: A" />
      </label>

      <label>
        Phòng
        <input name="room" required placeholder="Ví dụ: A101" />
      </label>

      <label>
        Hạng mục kiểm tra
        <select name="item" required>
          <option value="Đèn chiếu sáng">Đèn chiếu sáng</option>
          <option value="Quạt">Quạt</option>
          <option value="Bàn ghế">Bàn ghế</option>
          <option value="Cửa">Cửa</option>
          <option value="Thiết bị khác">Thiết bị khác</option>
        </select>
      </label>

      <label>
        Tình trạng
        <select name="condition" required>
          <option value="Tốt">Tốt</option>
          <option value="Cần sửa chữa">Cần sửa chữa</option>
          <option value="Hư hỏng">Hư hỏng</option>
        </select>
      </label>

      <label>
        Mô tả
        <textarea name="description" rows="3"
          placeholder="Mô tả hiện trạng..."></textarea>
      </label>

      <div class="actions">
        <button type="button" id="gps-button" class="secondary">
          Lấy vị trí GPS
        </button>
        <span id="gps-result">Chưa lấy vị trí</span>
      </div>


      <section class="photo-section">
        <label>Ảnh hiện trạng cơ sở vật chất</label>
        <div class="actions">
          <button type="button" id="camera-button" class="secondary">Chụp ảnh</button>
          <button type="button" id="remove-photo-button" class="secondary">Bỏ ảnh</button>
        </div>
        <input id="photo-input" type="file" accept="image/*" capture="environment" hidden />
        <img id="photo-preview" alt="Ảnh hiện trạng xem trước" hidden />
        <p id="photo-result">Chưa chụp ảnh</p>
      </section>

      <button type="submit" class="primary">Lưu phiếu khảo sát</button>
      <p id="message" role="status"></p>
    </form>

    <section class="records">
      <div class="records-heading">
        <h2>Phiếu đã ghi nhận</h2>
        <span id="record-count">0 phiếu</span>
      </div>
      <div id="record-list" class="record-list">
        <p class="empty">Đang tải dữ liệu...</p>
      </div>
    </section>
  </main>
`

type Survey = {
  id?: number
  syncId?: string
  building: string
  room: string
  item: string
  condition: string
  description: string
  createdAt: string
  latitude: number | null
  longitude: number | null
  photoDataUrl?: string | null
  syncStatus?: 'pending' | 'synced' | 'deleted'
  clientId?: string
  receivedAt?: string
}


type DeletionRequest = {
  clientId: string
  queuedAt: number
}


const form = document.querySelector<HTMLFormElement>('#survey-form')!
const message = document.querySelector<HTMLParagraphElement>('#message')!
const recordList = document.querySelector<HTMLDivElement>('#record-list')!
const recordCount = document.querySelector<HTMLSpanElement>('#record-count')!
const networkStatus =
  document.querySelector<HTMLSpanElement>('#network-status')!
const gpsResult = document.querySelector<HTMLSpanElement>('#gps-result')!
const photoInput = document.querySelector<HTMLInputElement>('#photo-input')!
const photoPreview = document.querySelector<HTMLImageElement>('#photo-preview')!
const photoResult = document.querySelector<HTMLParagraphElement>('#photo-result')!

let latitude: number | null = null
let longitude: number | null = null
let photoDataUrl: string | null = null

// Mở cơ sở dữ liệu IndexedDB
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('VKUFieldSurvey', 2)

    request.onupgradeneeded = () => {
      const db = request.result

      if (!db.objectStoreNames.contains('surveys')) {
        db.createObjectStore('surveys', {
          keyPath: 'id',
          autoIncrement: true,
        })
      }

      if (!db.objectStoreNames.contains('deletionQueue')) {
        db.createObjectStore('deletionQueue', {
          keyPath: 'clientId',
        })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

// Lưu một phiếu vào IndexedDB
async function saveSurvey(survey: Survey): Promise<void> {
  const db = await openDatabase()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction('surveys', 'readwrite')
    transaction.objectStore('surveys').add(survey)

    transaction.oncomplete = () => {
      db.close()
      resolve()
    }

    transaction.onerror = () => {
      db.close()
      reject(transaction.error)
    }

    transaction.onabort = () => {
      db.close()
      reject(transaction.error)
    }
  })
}

// Đọc tất cả phiếu đã lưu
async function getSurveys(): Promise<Survey[]> {
  const db = await openDatabase()

  return new Promise((resolve, reject) => {
    const transaction = db.transaction('surveys', 'readonly')
    const request = transaction.objectStore('surveys').getAll()

    request.onsuccess = () => {
      const surveys = (request.result as Survey[]).reverse()
      db.close()
      resolve(surveys)
    }

    request.onerror = () => {
      db.close()
      reject(request.error)
    }
  })
}


function getDeletionQueue(): Promise<DeletionRequest[]> {
  return new Promise((resolve, reject) => {
    openDatabase()
      .then((db) => {
        const transaction = db.transaction('deletionQueue', 'readonly')
        const store = transaction.objectStore('deletionQueue')
        const request = store.getAll()

        request.onsuccess = () => resolve(request.result as DeletionRequest[])
        request.onerror = () => reject(request.error)

        transaction.oncomplete = () => db.close()
        transaction.onerror = () => db.close()
        transaction.onabort = () => db.close()
      })
      .catch(reject)
  })
}


function enqueueDeletionAndRemoveLocal(
  id: number | undefined,
  clientId: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    openDatabase()
      .then((db) => {
        const transaction = db.transaction(
          ['surveys', 'deletionQueue'],
          'readwrite',
        )

        transaction.objectStore('deletionQueue').put({
          clientId,
          queuedAt: Date.now(),
        } satisfies DeletionRequest)

        if (id !== undefined) {
          transaction.objectStore('surveys').delete(id)
        }

        transaction.oncomplete = () => {
          db.close()
          resolve()
        }

        transaction.onerror = () => {
          db.close()
          reject(transaction.error)
        }

        transaction.onabort = () => {
          db.close()
          reject(transaction.error ?? new Error('Giao dịch đã bị hủy'))
        }
      })
      .catch(reject)
  })
}



async function flushDeletionQueue(): Promise<boolean> {
  if (!navigator.onLine) return false

  let requests: DeletionRequest[]
  let allSucceeded = true

  try {
    requests = await getDeletionQueue()
  } catch (error) {
    console.error('Không đọc được hàng đợi xóa:', error)
    return false
  }

  for (const item of requests) {
    if (!navigator.onLine) return false

    try {
      const response = await fetch(
        `${API_URL}/${encodeURIComponent(item.clientId)}`,
        { method: 'DELETE' },
      )

      const result = await response.json()

      if (!response.ok || result?.success !== true) {
        throw new Error(result?.error || `HTTP ${response.status}`)
      }

      await new Promise<void>((resolve, reject) => {
        openDatabase()
          .then((db) => {
            const transaction = db.transaction('deletionQueue', 'readwrite')

            transaction.objectStore('deletionQueue').delete(item.clientId)

            transaction.oncomplete = () => {
              db.close()
              resolve()
            }

            transaction.onerror = () => {
              db.close()
              reject(transaction.error)
            }

            transaction.onabort = () => {
              db.close()
              reject(transaction.error ?? new Error('Giao dịch đã bị hủy'))
            }
          })
          .catch(reject)
      })
    } catch (error) {
      console.warn('Yêu cầu xóa đang chờ đồng bộ:', error)
      allSucceeded = false
    }
  }

  return allSucceeded
}



const API_HOST = Capacitor.isNativePlatform()
  ? '10.0.2.2'
  : window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? '127.0.0.1'
    : window.location.hostname;
const API_URL = `http://${API_HOST}:3000/api/surveys`;
let syncInProgress = false;
let deletionInProgress = false;

async function updateSurveySyncStatus(
  id: number,
  status: 'pending' | 'synced' | 'deleted',
): Promise<void> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction('surveys', 'readwrite');
    const store = transaction.objectStore('surveys');
    const request = store.get(id);

    request.onsuccess = () => {
      if (request.result) {
        store.put({ ...request.result, syncStatus: status });
      }
    };

    transaction.oncomplete = () => {
      db.close();
      resolve();
    };

    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };

    transaction.onabort = () => {
      db.close();
      reject(transaction.error);
    };
  });
}

async function updateSurveySyncId(id: number, syncId: string): Promise<void> {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction('surveys', 'readwrite');
    const store = transaction.objectStore('surveys');
    let failure: Error | null = null;
    let closed = false;

    const closeDatabase = () => {
      if (!closed) {
        closed = true;
        db.close();
      }
    };

    const request = store.get(id);

    request.onsuccess = () => {
      const current = request.result as Survey | undefined;

      if (!current) {
        failure = new Error('Khong tim thay phieu id=' + id);
        transaction.abort();
        return;
      }

      if (current.syncId) return;

      store.put({ ...current, syncId });
    };

    request.onerror = () => {
      failure = request.error ?? new Error('Khong doc duoc phieu id=' + id);
    };

    transaction.oncomplete = () => {
      closeDatabase();
      resolve();
    };

    transaction.onabort = () => {
      closeDatabase();
      reject(failure ?? transaction.error ?? new Error('Ghi syncId that bai'));
    };
  });
}

async function ensurePendingSurveySyncIds(): Promise<void> {
  const records = await getSurveys();

  for (const record of records) {
    if (
      record.id === undefined ||
      record.syncId ||
      record.syncStatus === 'synced' ||
      record.syncStatus === 'deleted'
    ) {
      continue;
    }

    await updateSurveySyncId(record.id, crypto.randomUUID());
  }
}
async function syncPendingSurveys(): Promise<void> {
  if (!navigator.onLine || syncInProgress || deletionInProgress) return;

  syncInProgress = true;
  let syncedAny = false;

  try {
    
    await flushDeletionQueue()

    await ensurePendingSurveySyncIds();

    const records = await getSurveys();
    const pending = records.filter(
      (record) => record.id !== undefined && record.syncStatus !== 'synced' && record.syncStatus !== 'deleted',
    );

    for (const record of pending) {
      if (!navigator.onLine) break;

      try {
        const payload = { ...record }
        if (record.syncId) {
          delete payload.id
          delete payload.syncStatus
        }

        const response = await fetch(API_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const result = await response.json();

        if (!response.ok || result?.success !== true) {
          throw new Error(result?.error || 'HTTP ' + response.status);
        }

        await updateSurveySyncStatus(record.id!, 'synced');
        syncedAny = true;
      } catch (error) {
        console.warn('Dong bo chua thanh cong:', error);
        break;
      }
    }

    if (syncedAny) {
      message.textContent = 'Đã đồng bộ các phiếu lên máy chủ.';
      await renderRecords();
    }
  } catch (error) {
    console.warn('Khong the doc hang doi dong bo:', error);
  } finally {
    syncInProgress = false;
  }
}

function escapeHTML(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char]!)
}

function updateNetworkStatus() {
  networkStatus.textContent = navigator.onLine ? 'Có mạng' : 'Ngoại tuyến'
  networkStatus.classList.toggle('offline', !navigator.onLine)
}

window.addEventListener('online', updateNetworkStatus)
window.addEventListener('online', () => { void syncPendingSurveys() })
window.addEventListener('offline', updateNetworkStatus)
updateNetworkStatus()

async function renderRecords() {
  try {
    let records: Survey[]

    if (navigator.onLine) {
      try {
        const response = await fetch(API_URL, { cache: 'no-store' })
        if (!response.ok) throw new Error('HTTP ' + response.status)

        
        const remoteRecords = await response.json()
        if (!Array.isArray(remoteRecords)) {
          throw new Error('API không trả về danh sách phiếu')
        }

        const queuedDeletions = await getDeletionQueue()
        const pendingDeleteIds = new Set(
          queuedDeletions.map((item) => item.clientId),
        )

        const visibleRemoteRecords = (remoteRecords as Survey[]).filter(
          (record) => !pendingDeleteIds.has(
            record.syncId ?? String(record.clientId ?? record.id ?? ''),
          ),
        )


        const localRecords = await getSurveys()
        const localBySyncId = new Map(
          localRecords
            .filter((local) => local.syncId !== undefined)
            .map((local) => [local.syncId!, local]),
        )
        const remoteSyncIds = new Set(
          visibleRemoteRecords
            .map((remote) => remote.syncId)
            .filter((syncId): syncId is string => syncId !== undefined),
        )

        records = visibleRemoteRecords.map((remote) => {
          const local = remote.syncId
            ? localBySyncId.get(remote.syncId)
            : undefined

          return local
            ? { ...remote, id: local.id, syncStatus: local.syncStatus }
            : remote.syncId
              ? { ...remote, syncStatus: 'synced' }
              : { ...remote, id: undefined, syncStatus: 'synced' }
        })

        records.push(
          ...localRecords.filter(
            (local) => !local.syncId || !remoteSyncIds.has(local.syncId),
          ),
        )
      } catch (error) {
        console.warn('Không tải được phiếu từ máy chủ; dùng IndexedDB:', error)
        records = await getSurveys()
      }
    } else {
      records = await getSurveys()
    }

    recordCount.textContent = `${records.length} phiếu`

    recordList.innerHTML = records.length
      ? records.map((record) => `
          <article class="record">
            <div class="record-top">
              <strong>${escapeHTML(record.building)} / ${escapeHTML(record.room)}</strong>
              <span>${escapeHTML(record.condition)}</span>
            </div>
            <p>${escapeHTML(record.item)}</p>
            ${record.photoDataUrl ? `<img class="record-photo" src="${record.photoDataUrl}" alt="Ảnh hiện trường" />` : ''}
            <p>${escapeHTML(record.description || 'Không có mô tả')}</p>
            ${
              record.latitude !== null && record.longitude !== null
                ? `<p>GPS: ${record.latitude.toFixed(5)}, ${record.longitude.toFixed(5)}</p>`
                : ''
            }
            <p>${record.syncStatus === 'deleted' ? 'Đã xóa trên máy chủ; cần dọn dữ liệu cục bộ' : record.syncStatus === 'synced' ? 'Đã đồng bộ' : 'Chưa đồng bộ'}</p>
            <small>${escapeHTML(record.createdAt)}</small>
            ${record.syncId ? `<button type="button" class="record-delete" data-local-id="${record.id ?? ''}" data-sync-id="${escapeHTML(record.syncId)}">Xóa</button>` : '<small>Phiếu định danh cũ; cần đối soát trước khi xóa.</small>'}
          </article>
        `).join('')
      : '<p class="empty">Chưa có phiếu khảo sát.</p>'
  } catch (error) {
    console.error(error)
    message.textContent = 'Không đọc được dữ liệu. Hãy kiểm tra trình duyệt.'
  }
}


recordList.addEventListener('click', async (event) => {
  const target = event.target
  if (!(target instanceof Element)) return

  const button = target.closest<HTMLButtonElement>('[data-local-id]')
  if (!button) return

  const localId = button.dataset.localId
    ? Number(button.dataset.localId)
    : undefined
  const syncId = button.dataset.syncId || undefined
  const clientId = syncId

  if ((localId !== undefined && (!Number.isSafeInteger(localId) || localId < 1)) || !clientId) {
    message.textContent = 'Mã phiếu không hợp lệ.'
    return
  }

  if (syncInProgress || deletionInProgress) {
    message.textContent = 'Đang xử lý đồng bộ hoặc xóa. Hãy thử lại sau.'
    return
  }

  if (!confirm(
    `Xóa phiếu có mã ${clientId}? Nếu ngoại tuyến, yêu cầu xóa sẽ chờ có mạng.`,
  )) {
    return
  }

  deletionInProgress = true
  button.disabled = true

  try {
    await enqueueDeletionAndRemoveLocal(localId, clientId)

    message.textContent = navigator.onLine
      ? 'Đã xóa khỏi thiết bị. Đang đồng bộ yêu cầu xóa lên máy chủ...'
      : 'Đã xóa khỏi thiết bị. Yêu cầu xóa máy chủ đang chờ có mạng.'

    await renderRecords()
  } catch (error) {
    console.error('Không thể lưu yêu cầu xóa:', error)
    message.textContent =
      'Không thể lưu yêu cầu xóa. Dữ liệu cục bộ chưa được xác nhận là đã xóa.'
  } finally {
    deletionInProgress = false
    button.disabled = false

    if (navigator.onLine) {
      void syncPendingSurveys()
    }
  }
})

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  message.textContent = 'Đang lưu phiếu...'

  const data = new FormData(form)

  const survey: Survey = {
    syncId: crypto.randomUUID(),
    building: String(data.get('building')).trim(),
    room: String(data.get('room')).trim(),
    item: String(data.get('item')),
    condition: String(data.get('condition')),
    description: String(data.get('description')).trim(),
    createdAt: new Date().toLocaleString('vi-VN'),
    latitude,
    longitude,
    photoDataUrl,
    syncStatus: 'pending',
  }

  try {
    await saveSurvey(survey)
    if (navigator.onLine) await syncPendingSurveys()
    await renderRecords()

    message.textContent = 'Đã lưu phiếu vào bộ nhớ của trình duyệt.'
    form.reset()

    latitude = null
    longitude = null
    photoDataUrl = null
    photoPreview.removeAttribute('src')
    photoPreview.hidden = true
    photoResult.textContent = 'Chưa chụp ảnh'
    photoInput.value = ''
    gpsResult.textContent = 'Chưa lấy vị trí'
  } catch (error) {
    console.error(error)
    message.textContent = 'Lưu thất bại. Hãy thử lại.'
  }
})


document.querySelector<HTMLButtonElement>('#gps-button')!
  .addEventListener('click', async () => {
    gpsResult.textContent = 'Đang lấy vị trí...';

    try {
      if (Capacitor.isNativePlatform()) {
        const permission = await Geolocation.requestPermissions();
        if (permission.location === 'denied' ||
            permission.coarseLocation === 'denied') {
          throw new Error('Quyền vị trí bị từ chối');
        }

        const position = await Geolocation.getCurrentPosition({
          enableHighAccuracy: true,
          timeout: 15000
        });
        latitude = position.coords.latitude;
        longitude = position.coords.longitude;
      } else {
        const position = await new Promise<GeolocationPosition>((resolve, reject) => {
          if (!navigator.geolocation) {
            reject(new Error('Trình duyệt không hỗ trợ định vị'));
            return;
          }
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 15000
          });
        });
        latitude = position.coords.latitude;
        longitude = position.coords.longitude;
      }

      gpsResult.textContent = latitude.toFixed(5) + ', ' + longitude.toFixed(5);
    } catch (error) {
      console.error('Lấy GPS thất bại:', error);
      gpsResult.textContent = 'Không lấy được vị trí. Hãy kiểm tra quyền vị trí và GPS.';
    }
  });

document.querySelector<HTMLButtonElement>('#camera-button')!
  .addEventListener('click', async () => {
    if (!Capacitor.isNativePlatform()) {
      photoInput.click();
      return;
    }

    try {
      const photo = await Camera.getPhoto({
        quality: 60,
        width: 1280,
        allowEditing: false,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Camera
      });

      if (!photo.dataUrl) throw new Error('Camera không trả về dữ liệu ảnh');
      photoDataUrl = photo.dataUrl;
      photoPreview.src = photoDataUrl;
      photoPreview.hidden = false;
      photoResult.textContent = 'Đã chụp ảnh';
    } catch (error) {
      console.error('Chụp ảnh th?t b?i:', error);
      photoResult.textContent = 'Chưa có ảnh hoặc thao tác chụp đã bị hủy.';
    }
  });

photoInput.addEventListener('change', () => {
  const file = photoInput.files?.[0];
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    photoResult.textContent = 'Tệp đã chọn không phải ảnh.';
    return;
  }

  if (file.size > 8 * 1024 * 1024) {
    photoResult.textContent = 'Ảnh quá lớn (trên 8 MB). Hãy chọn ảnh nhỏ hơn.';
    photoInput.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    if (typeof reader.result !== 'string') return;
    photoDataUrl = reader.result;
    photoPreview.src = photoDataUrl;
    photoPreview.hidden = false;
    photoResult.textContent = 'Đã chọn ảnh';
  };
  reader.onerror = () => {
    photoResult.textContent = 'Không đọc được ảnh.';
  };
  reader.readAsDataURL(file);
});

document.querySelector<HTMLButtonElement>('#remove-photo-button')!
  .addEventListener('click', () => {
    photoDataUrl = null;
    photoPreview.removeAttribute('src');
    photoPreview.hidden = true;
    photoInput.value = '';
    photoResult.textContent = 'Chưa chụp ảnh';
  });


// Tải lại phiếu khi mở ứng dụng
renderRecords()
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', async () => {
    try {
      await navigator.serviceWorker.register('/sw.js')
      console.log('Service Worker da duoc dang ky.')
    } catch (error) {
      console.error('Dang ky Service Worker that bai:', error)
    }
  })
}




void syncPendingSurveys()
