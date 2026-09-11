
// Карта покрытия МТС: Интерактивный клиент
let map = null;
let currentLayer = null;
let currentLayerType = 'g5_New'; // По умолчанию 5G
let currentPlacemark = null;
let currentCoords = [55.7903, 49.1228]; // Казань по умолчанию

const MTS_TILES_BASE = 'https://tiles.qsupport.mts.ru';

// Инициализация Yandex Maps
ymaps.ready(initMap);

function initMap() {
  map = new ymaps.Map('map', {
    center: currentCoords,
    zoom: 12,
    controls: ['zoomControl', 'fullscreenControl', 'typeSelector']
  }, {
    suppressMapOpenBlock: true,
    minZoom: 7,
    maxZoom: 18
  });

  // Устанавливаем стартовый слой покрытия МТС (5G)
  setMtsLayer(currentLayerType);

  // Слушатель клика по карте
  map.events.add('click', function (e) {
    const coords = e.get('coords');
    checkLocation(coords, 'Выбранная точка');
  });

  // Автодополнение адресов Яндекса для поля ввода
  try {
    const suggestView = new ymaps.SuggestView('addressInput', {
      provider: {
        suggest: function (request, options) {
          return ymaps.suggest(request);
        }
      },
      results: 5
    });

    suggestView.events.add('select', function (e) {
      const selectedValue = e.get('item').value;
      geocodeAddress(selectedValue);
    });
  } catch (err) {
    console.warn('SuggestView warning:', err);
  }

  // Привязка кнопок управления
  setupEventListeners();

  // Начальная проверка Казани
  checkLocation(currentCoords, 'г. Казань (центр)');
}

// Создание и установка слоя МТС
function setMtsLayer(layerType) {
  if (currentLayer) {
    map.layers.remove(currentLayer);
  }

  currentLayerType = layerType;

  // Создаем слой тайлов МТС
  currentLayer = new ymaps.Layer('', {
    tileTransparent: true,
    zIndex: 200,
    opacity: 0.85
  });

  // Официальный алгоритм МТС формирования URL тайлов
  currentLayer.getTileUrl = function (tile, zoom) {
    const z = zoom > 12 ? 12 : zoom; // МТС генерирует тайлы до 12 зума
    return `${MTS_TILES_BASE}/${layerType}/${z}/${tile[0]}/${tile[1]}/`;
  };

  currentLayer.getTileSize = function () {
    return [256, 256];
  };

  map.layers.add(currentLayer);
}

// Проверка и центрирование на координатах
function checkLocation(coords, label = 'Точка на карте') {
  currentCoords = coords;
  showLoader('Анализ покрытия и адреса...');

  // Обновляем маркер
  if (currentPlacemark) {
    currentPlacemark.geometry.setCoordinates(coords);
  } else {
    currentPlacemark = new ymaps.Placemark(coords, {
      hintContent: 'Проверяемая точка',
      balloonContent: 'Анализ покрытия...'
    }, {
      preset: 'islands#redDotIconWithCaption',
      draggable: true
    });

    currentPlacemark.events.add('dragend', function () {
      const newCoords = currentPlacemark.geometry.getCoordinates();
      checkLocation(newCoords, 'Перемещенный маркер');
    });

    map.geoObjects.add(currentPlacemark);
  }

  // Плавный переход к точке
  map.panTo(coords, { flying: true, duration: 800 });

  // Обновляем панель инфо
  const panel = document.getElementById('infoPanel');
  panel.classList.remove('hidden');

  document.getElementById('pointTitle').textContent = label;
  document.getElementById('pointCoords').textContent = `${coords[0].toFixed(5)}, ${coords[1].toFixed(5)}`;
  document.getElementById('pointAddress').textContent = 'Определение адреса...';

  // Сброс статусов
  const techKeys = ['g5_New', 'g5', 'lte_New', 'g3_New', 'g2_New'];
  techKeys.forEach(k => {
    const badge = document.getElementById(`status-${k}`);
    if (badge) {
      badge.textContent = 'Проверка...';
      badge.className = 'tech-status status-loading';
    }
  });

  // Обратное геокодирование адреса
  ymaps.geocode(coords).then(res => {
    const firstGeoObject = res.geoObjects.get(0);
    let addressText = 'Адрес не определен';
    if (firstGeoObject) {
      addressText = firstGeoObject.getAddressLine();
    }
    document.getElementById('pointAddress').textContent = addressText;
    currentPlacemark.properties.set('balloonContent', `<b>${addressText}</b><br>Координаты: ${coords[0].toFixed(5)}, ${coords[1].toFixed(5)}`);
  }).catch(() => {
    document.getElementById('pointAddress').textContent = 'Координаты: ' + coords[0].toFixed(5) + ', ' + coords[1].toFixed(5);
  });

  // Опрос доступности сетей (через встроенный API бэкенда либо визуальный маркер)
  checkNetworkAvailability(coords);
}

// Запрос проверки сетей (бэкенд или визуальная оценка)
function checkNetworkAvailability(coords) {
  const [lat, lon] = coords;
  const apiUrl = `/api/check?lat=${lat}&lon=${lon}`;

  fetch(apiUrl)
    .then(resp => {
      if (!resp.ok) throw new Error('API unavailable');
      return resp.json();
    })
    .then(data => {
      hideLoader();
      updateBadgesFromApi(data);
    })
    .catch(() => {
      // Если бэкенд не запущен (например открыт просто локальный index.html на GitHub Pages)
      hideLoader();
      updateBadgesStaticMode();
    });
}

function updateBadgesFromApi(data) {
  // data: { "g5_New": bool, "g5": bool, "lte_New": bool, "g3_New": bool, "g2_New": bool }
  for (const [tech, available] of Object.entries(data)) {
    const badge = document.getElementById(`status-${tech}`);
    if (badge) {
      if (available) {
        badge.textContent = '✓ Доступно';
        badge.className = 'tech-status status-available';
      } else {
        badge.textContent = '✕ Нет зоны';
        badge.className = 'tech-status status-none';
      }
    }
  }
}

function updateBadgesStaticMode() {
  // В статическом режиме подсказываем пользователю смотреть на слой
  const currentTab = document.querySelector('.layer-tab.active');
  const activeName = currentTab ? currentTab.dataset.name : '5G';
  
  const techKeys = ['g5_New', 'g5', 'lte_New', 'g3_New', 'g2_New'];
  techKeys.forEach(k => {
    const badge = document.getElementById(`status-${k}`);
    if (badge) {
      if (k === currentLayerType) {
        badge.textContent = '👀 Отображен на карте';
        badge.className = 'tech-status status-visual';
      } else {
        badge.textContent = 'Переключите слой';
        badge.className = 'tech-status status-loading';
      }
    }
  });
}

// Поиск по текстовому адресу или координатам
function geocodeAddress(query) {
  if (!query || !query.trim()) return;
  const q = query.trim();
  showLoader('Поиск адреса...');

  // Проверяем, не введены ли координаты вида "55.7903, 49.1228"
  const coordRegex = /^[-+]?([1-8]?\d(\.\d+)?|90(\.0+)?),\s*[-+]?(180(\.0+)?|((1[0-7]\d)|([1-9]?\d))(\.\d+)?)$/;
  if (coordRegex.test(q)) {
    const parts = q.split(',').map(s => parseFloat(s.trim()));
    checkLocation(parts, 'Введенные координаты');
    return;
  }

  // Геокодирование через Яндекс
  ymaps.geocode(q, { results: 1 }).then(res => {
    const geoObject = res.geoObjects.get(0);
    if (geoObject) {
      const coords = geoObject.geometry.getCoordinates();
      checkLocation(coords, geoObject.getAddressLine() || q);
    } else {
      hideLoader();
      alert('Адрес не найден. Попробуйте уточнить город или улицу.');
    }
  }).catch(err => {
    hideLoader();
    alert('Ошибка при поиске адреса: ' + err.message);
  });
}

// Запрос геопозиции браузера (GPS)
function requestUserGeolocation() {
  showLoader('Запрос геопозиции...');
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      pos => {
        const coords = [pos.coords.latitude, pos.coords.longitude];
        checkLocation(coords, '📍 Ваше местоположение');
      },
      err => {
        console.warn('HTML5 Geolocation fallback to Yandex:', err.message);
        // Резервный провайдер через ymaps
        ymaps.geolocation.get({ provider: 'auto', mapStateAutoApply: false })
          .then(res => {
            const coords = res.geoObjects.get(0).geometry.getCoordinates();
            checkLocation(coords, '📍 Ваше местоположение (IP)');
          })
          .catch(e => {
            hideLoader();
            alert('Не удалось определить геолокацию. Разрешите доступ к местоположению в браузере или введите адрес вручную.');
          });
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  } else {
    ymaps.geolocation.get({ provider: 'auto', mapStateAutoApply: false })
      .then(res => {
        const coords = res.geoObjects.get(0).geometry.getCoordinates();
        checkLocation(coords, '📍 Ваше местоположение');
      })
      .catch(() => {
        hideLoader();
        alert('Геолокация не поддерживается вашим браузером. Введите адрес вручную.');
      });
  }
}

// Привязка событий
function setupEventListeners() {
  const addressInput = document.getElementById('addressInput');
  const searchBtn = document.getElementById('searchBtn');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  const geoBtn = document.getElementById('geoBtn');
  const closePanelBtn = document.getElementById('closePanelBtn');
  const recheckBtn = document.getElementById('recheckBtn');

  // Поиск по кнопке и Enter
  searchBtn.addEventListener('click', () => geocodeAddress(addressInput.value));
  addressInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') geocodeAddress(addressInput.value);
  });

  // Кнопка очистки поля ввода
  addressInput.addEventListener('input', () => {
    clearSearchBtn.style.display = addressInput.value.length > 0 ? 'block' : 'none';
  });
  clearSearchBtn.addEventListener('click', () => {
    addressInput.value = '';
    clearSearchBtn.style.display = 'none';
    addressInput.focus();
  });

  // Кнопка "Мое местоположение"
  geoBtn.addEventListener('click', requestUserGeolocation);

  // Кнопка закрытия панели
  closePanelBtn.addEventListener('click', () => {
    document.getElementById('infoPanel').classList.add('hidden');
  });

  // Кнопка перепроверки
  recheckBtn.addEventListener('click', () => {
    checkLocation(currentCoords, document.getElementById('pointTitle').textContent);
  });

  // Вкладки слоев МТС (5G, 4G, 3G, 2G, NB-IoT)
  const tabs = document.querySelectorAll('.layer-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const layer = tab.dataset.layer;
      setMtsLayer(layer);
      
      // Обновляем плашку в панели
      const badge = document.getElementById(`status-${layer}`);
      if (badge && badge.textContent.includes('Отображен')) {
        // ok
      }
    });
  });

  // Пресеты городов
  const presetBtns = document.querySelectorAll('.preset-btn');
  presetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const lat = parseFloat(btn.dataset.lat);
      const lon = parseFloat(btn.dataset.lon);
      const zoom = parseInt(btn.dataset.zoom, 10);
      map.setCenter([lat, lon], zoom, { duration: 600 });
      checkLocation([lat, lon], btn.textContent);
    });
  });
}

function showLoader(text = 'Загрузка...') {
  const overlay = document.getElementById('loaderOverlay');
  document.getElementById('loaderText').textContent = text;
  overlay.classList.remove('hidden');
}

function hideLoader() {
  document.getElementById('loaderOverlay').classList.add('hidden');
}
