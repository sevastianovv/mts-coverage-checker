
// Карта покрытия МТС: Интерактивный клиент (Mobile-First Bottom Sheet)
let map = null;
let currentLayer = null;
let currentLayerType = 'g5_New'; // По умолчанию 5G
let currentPlacemark = null;
let currentCoords = [55.7903, 49.1228]; // Казань

const MTS_TILES_BASE = 'https://tiles.qsupport.mts.ru';

const LAYER_NAMES = {
  'g5_New': '5G 300М',
  'g5': 'Супер 5G',
  'lte_New': '4G LTE',
  'g3_New': '3G',
  'g2_New': '2G',
  'nb_iot': 'NB-IoT'
};

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

  // Устанавливаем начальный слой МТС (5G)
  setMtsLayer(currentLayerType);

  // Слушатель клика по карте
  map.events.add('click', function (e) {
    const coords = e.get('coords');
    checkLocation(coords, 'Выбранная точка');
  });

  // Яндекс Саджест адресов
  try {
    const suggestView = new ymaps.SuggestView('addressInput', {
      provider: {
        suggest: function (request) {
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

  // Привязка UI событий
  setupEventListeners();

  // Начальная точка в центре Казани (в свернутом режиме, чтобы не перекрывать карту)
  checkLocation(currentCoords, 'г. Казань (центр)');
}

// Создание и установка слоя МТС
function setMtsLayer(layerType) {
  if (currentLayer) {
    map.layers.remove(currentLayer);
  }

  currentLayerType = layerType;

  currentLayer = new ymaps.Layer('', {
    tileTransparent: true,
    zIndex: 200,
    opacity: 0.85
  });

  // Правило тайлов МТС
  currentLayer.getTileUrl = function (tile, zoom) {
    const z = zoom > 12 ? 12 : zoom;
    return `${MTS_TILES_BASE}/${layerType}/${z}/${tile[0]}/${tile[1]}/`;
  };

  currentLayer.getTileSize = function () {
    return [256, 256];
  };

  map.layers.add(currentLayer);

  // Обновляем бейдж активного слоя в инфо-панели
  const activePill = document.getElementById('activeLayerPill');
  if (activePill) {
    activePill.textContent = LAYER_NAMES[layerType] || layerType;
  }
}

// Проверка точки
function checkLocation(coords, label = 'Точка на карте') {
  currentCoords = coords;

  // Маркер
  if (currentPlacemark) {
    currentPlacemark.geometry.setCoordinates(coords);
  } else {
    currentPlacemark = new ymaps.Placemark(coords, {
      hintContent: 'Проверяемая точка',
      balloonContent: 'Определение покрытия...'
    }, {
      preset: 'islands#redDotIconWithCaption',
      draggable: true
    });

    currentPlacemark.events.add('dragend', function () {
      const newCoords = currentPlacemark.geometry.getCoordinates();
      checkLocation(newCoords, 'Перемещенная точка');
    });

    map.geoObjects.add(currentPlacemark);
  }

  // Плавный полет к точке
  map.panTo(coords, { flying: true, duration: 600 });

  // Показываем панель в СВЕРНУТОМ виде (minimized), чтобы не закрывать экран на мобильном!
  const panel = document.getElementById('infoPanel');
  panel.classList.remove('hidden');
  
  // На мобильных по умолчанию держим свернутым
  if (window.innerWidth <= 768) {
    panel.classList.add('minimized');
    panel.classList.remove('expanded');
    // Скрываем плавающую кнопку открытия, пока панель показана
    document.getElementById('openPanelFab').classList.add('hidden');
  }

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
    let addressText = 'Координаты: ' + coords[0].toFixed(5) + ', ' + coords[1].toFixed(5);
    if (firstGeoObject) {
      addressText = firstGeoObject.getAddressLine();
    }
    document.getElementById('pointAddress').textContent = addressText;
    currentPlacemark.properties.set('balloonContent', `<b>${addressText}</b>`);
  }).catch(() => {
    document.getElementById('pointAddress').textContent = coords[0].toFixed(5) + ', ' + coords[1].toFixed(5);
  });

  // Запрос доступности
  checkNetworkAvailability(coords);
}

// Запрос доступности (API бэкенда либо статический режим)
function checkNetworkAvailability(coords) {
  const [lat, lon] = coords;
  fetch(`/api/check?lat=${lat}&lon=${lon}`)
    .then(resp => {
      if (!resp.ok) throw new Error('API unavailable');
      return resp.json();
    })
    .then(data => {
      hideLoader();
      updateBadgesFromApi(data);
    })
    .catch(() => {
      hideLoader();
      updateBadgesStaticMode();
    });
}

function updateBadgesFromApi(data) {
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
  const techKeys = ['g5_New', 'g5', 'lte_New', 'g3_New', 'g2_New'];
  techKeys.forEach(k => {
    const badge = document.getElementById(`status-${k}`);
    if (badge) {
      if (k === currentLayerType) {
        badge.textContent = '👀 На карте';
        badge.className = 'tech-status status-visual';
      } else {
        badge.textContent = 'Клик для показа';
        badge.className = 'tech-status status-loading';
      }
    }
  });
}

// Геокодирование адреса
function geocodeAddress(query) {
  if (!query || !query.trim()) return;
  const q = query.trim();
  showLoader('Поиск...');

  const coordRegex = /^[-+]?([1-8]?\d(\.\d+)?|90(\.0+)?),\s*[-+]?(180(\.0+)?|((1[0-7]\d)|([1-9]?\d))(\.\d+)?)$/;
  if (coordRegex.test(q)) {
    const parts = q.split(',').map(s => parseFloat(s.trim()));
    checkLocation(parts, 'Координаты');
    hideLoader();
    return;
  }

  ymaps.geocode(q, { results: 1 }).then(res => {
    hideLoader();
    const geoObject = res.geoObjects.get(0);
    if (geoObject) {
      const coords = geoObject.geometry.getCoordinates();
      checkLocation(coords, geoObject.getAddressLine() || q);
    } else {
      alert('Адрес не найден. Попробуйте уточнить запрос.');
    }
  }).catch(err => {
    hideLoader();
    alert('Ошибка поиска: ' + err.message);
  });
}

// Запрос геопозиции
function requestUserGeolocation() {
  showLoader('Определение локации...');
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      pos => {
        const coords = [pos.coords.latitude, pos.coords.longitude];
        checkLocation(coords, 'Ваше местоположение');
      },
      err => {
        console.warn('Geolocation fallback:', err.message);
        ymaps.geolocation.get({ provider: 'auto', mapStateAutoApply: false })
          .then(res => {
            const coords = res.geoObjects.get(0).geometry.getCoordinates();
            checkLocation(coords, 'Ваше местоположение');
          })
          .catch(() => {
            hideLoader();
            alert('Разрешите доступ к геолокации в браузере.');
          });
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
    );
  } else {
    ymaps.geolocation.get({ provider: 'auto', mapStateAutoApply: false })
      .then(res => {
        const coords = res.geoObjects.get(0).geometry.getCoordinates();
        checkLocation(coords, 'Ваше местоположение');
      })
      .catch(() => {
        hideLoader();
        alert('Геолокация недоступна. Введите адрес вручную.');
      });
  }
}

// Привязка событий
function setupEventListeners() {
  const addressInput = document.getElementById('addressInput');
  const searchBtn = document.getElementById('searchBtn');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  const geoBtn = document.getElementById('geoBtn');
  const fabGeoBtn = document.getElementById('fabGeoBtn');
  const openPanelFab = document.getElementById('openPanelFab');
  const closePanelBtn = document.getElementById('closePanelBtn');
  const toggleExpandBtn = document.getElementById('toggleExpandBtn');
  const sheetToggleBar = document.getElementById('sheetToggleBar');
  const panelHeader = document.getElementById('panelHeader');
  const infoPanel = document.getElementById('infoPanel');
  const recheckBtn = document.getElementById('recheckBtn');

  // Поиск
  searchBtn.addEventListener('click', () => geocodeAddress(addressInput.value));
  addressInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') geocodeAddress(addressInput.value);
  });

  addressInput.addEventListener('input', () => {
    clearSearchBtn.style.display = addressInput.value.length > 0 ? 'block' : 'none';
  });
  clearSearchBtn.addEventListener('click', () => {
    addressInput.value = '';
    clearSearchBtn.style.display = 'none';
    addressInput.focus();
  });

  // GPS кнопки (десктопная и мобильная плавающая)
  if (geoBtn) geoBtn.addEventListener('click', requestUserGeolocation);
  if (fabGeoBtn) fabGeoBtn.addEventListener('click', requestUserGeolocation);

  // Сворачивание / разворачивание панели
  function togglePanelExpansion() {
    if (infoPanel.classList.contains('minimized')) {
      infoPanel.classList.remove('minimized');
      infoPanel.classList.add('expanded');
    } else {
      infoPanel.classList.remove('expanded');
      infoPanel.classList.add('minimized');
    }
  }

  if (toggleExpandBtn) toggleExpandBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePanelExpansion();
  });

  if (sheetToggleBar) sheetToggleBar.addEventListener('click', togglePanelExpansion);
  
  if (panelHeader) panelHeader.addEventListener('click', (e) => {
    // Если кликнули не по крестику
    if (!e.target.closest('.action-btn')) {
      togglePanelExpansion();
    }
  });

  // Полное закрытие панели
  if (closePanelBtn) closePanelBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    infoPanel.classList.add('hidden');
    openPanelFab.classList.remove('hidden');
  });

  // Восстановление панели
  if (openPanelFab) openPanelFab.addEventListener('click', () => {
    infoPanel.classList.remove('hidden');
    openPanelFab.classList.add('hidden');
  });

  // Перепроверка
  if (recheckBtn) recheckBtn.addEventListener('click', () => {
    checkLocation(currentCoords, document.getElementById('pointTitle').textContent);
  });

  // Переключение слоев через чипсы
  const chips = document.querySelectorAll('.layer-chip');
  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      chips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      const layer = chip.dataset.layer;
      setMtsLayer(layer);
      updateBadgesStaticMode();
    });
  });

  // Клик по строке сети в панели тоже переключает слой на карте!
  const techCards = document.querySelectorAll('.tech-card');
  techCards.forEach(card => {
    card.addEventListener('click', () => {
      const layer = card.dataset.layerClick;
      if (layer) {
        chips.forEach(c => {
          if (c.dataset.layer === layer) {
            c.click();
          }
        });
      }
    });
  });

  // Пресеты городов
  const cityChips = document.querySelectorAll('.city-chip');
  cityChips.forEach(btn => {
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
