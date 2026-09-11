
// Карта покрытия МТС: v3.0 (Сверхкомпактная нижняя плашка, 100% открытая карта)
let map = null;
let currentLayer = null;
let currentLayerType = 'g5_New'; // По умолчанию 5G
let currentPlacemark = null;
let currentCoords = [55.7903, 49.1228]; // Казань по умолчанию

const MTS_TILES_BASE = 'https://tiles.qsupport.mts.ru';

const LAYER_NAMES = {
  'g5_New': '5G 300М',
  'g5': 'Супер 5G',
  'lte_New': '4G LTE',
  'g3_New': '3G',
  'g2_New': '2G',
  'nb_iot': 'NB-IoT'
};

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

  // Клик по карте
  map.events.add('click', function (e) {
    const coords = e.get('coords');
    checkLocation(coords, 'Выбранная точка');
  });

  // Саджест адресов
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
      geocodeAddress(e.get('item').value);
    });
  } catch (err) {
    console.warn('SuggestView:', err);
  }

  setupEventListeners();

  // ВАЖНО: При старте НИКАКИХ ОКОН И ПЛАШЕК НЕ ПОКАЗЫВАЕМ!
  // Карта полностью чистая и открытая.
}

// Установка слоя МТС
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

  currentLayer.getTileUrl = function (tile, zoom) {
    const z = zoom > 12 ? 12 : zoom;
    return `${MTS_TILES_BASE}/${layerType}/${z}/${tile[0]}/${tile[1]}/`;
  };

  currentLayer.getTileSize = function () {
    return [256, 256];
  };

  map.layers.add(currentLayer);

  const pillBadge = document.getElementById('pillBadge');
  if (pillBadge) {
    pillBadge.textContent = LAYER_NAMES[layerType] || layerType;
  }
}

// Выбор точки (вызывается ТОЛЬКО когда пользователь сам нажал на карту или GPS)
function checkLocation(coords, label = 'Точка на карте') {
  currentCoords = coords;

  if (currentPlacemark) {
    currentPlacemark.geometry.setCoordinates(coords);
  } else {
    currentPlacemark = new ymaps.Placemark(coords, {
      hintContent: 'Проверяемая точка',
      balloonContent: 'Определение адреса...'
    }, {
      preset: 'islands#redDotIconWithCaption',
      draggable: true
    });

    currentPlacemark.events.add('dragend', function () {
      checkLocation(currentPlacemark.geometry.getCoordinates(), 'Перемещенная точка');
    });

    map.geoObjects.add(currentPlacemark);
  }

  map.panTo(coords, { flying: true, duration: 600 });

  // Показываем ТОЛЬКО компактную плашку высотой 48px внизу!
  const pill = document.getElementById('bottomPill');
  pill.classList.remove('hidden');

  document.getElementById('pillAddress').textContent = 'Определение адреса...';
  document.getElementById('pillCoords').textContent = `${coords[0].toFixed(5)}, ${coords[1].toFixed(5)}`;
  document.getElementById('pillBadge').textContent = LAYER_NAMES[currentLayerType] || currentLayerType;

  // Обратное геокодирование
  ymaps.geocode(coords).then(res => {
    const firstGeoObject = res.geoObjects.get(0);
    let addressText = coords[0].toFixed(5) + ', ' + coords[1].toFixed(5);
    if (firstGeoObject) {
      addressText = firstGeoObject.getAddressLine();
    }
    document.getElementById('pillAddress').textContent = addressText;
    currentPlacemark.properties.set('balloonContent', `<b>${addressText}</b><br>Слой: ${LAYER_NAMES[currentLayerType]}`);
  }).catch(() => {
    document.getElementById('pillAddress').textContent = coords[0].toFixed(5) + ', ' + coords[1].toFixed(5);
  });
}

// Поиск адреса
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
      checkLocation(geoObject.geometry.getCoordinates(), geoObject.getAddressLine() || q);
    } else {
      alert('Адрес не найден.');
    }
  }).catch(err => {
    hideLoader();
    alert('Ошибка поиска: ' + err.message);
  });
}

// GPS геолокация
function requestUserGeolocation() {
  showLoader('Определение локации...');
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      pos => {
        hideLoader();
        checkLocation([pos.coords.latitude, pos.coords.longitude], 'Ваше местоположение');
      },
      err => {
        console.warn('Geolocation fallback:', err.message);
        ymaps.geolocation.get({ provider: 'auto', mapStateAutoApply: false })
          .then(res => {
            hideLoader();
            checkLocation(res.geoObjects.get(0).geometry.getCoordinates(), 'Ваше местоположение');
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
        hideLoader();
        checkLocation(res.geoObjects.get(0).geometry.getCoordinates(), 'Ваше местоположение');
      })
      .catch(() => {
        hideLoader();
        alert('Геолокация недоступна.');
      });
  }
}

// Слушатели событий
function setupEventListeners() {
  const addressInput = document.getElementById('addressInput');
  const searchBtn = document.getElementById('searchBtn');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  const geoBtn = document.getElementById('geoBtn');
  const fabGeoBtn = document.getElementById('fabGeoBtn');
  const bottomPill = document.getElementById('bottomPill');
  const pillToggleArea = document.getElementById('pillToggleArea');
  const pillCloseBtn = document.getElementById('pillCloseBtn');
  const detailsDropdown = document.getElementById('detailsDropdown');
  const detailsCloseBtn = document.getElementById('detailsCloseBtn');

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

  if (geoBtn) geoBtn.addEventListener('click', requestUserGeolocation);
  if (fabGeoBtn) fabGeoBtn.addEventListener('click', requestUserGeolocation);

  // Закрытие мини-плашки
  if (pillCloseBtn) {
    pillCloseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      bottomPill.classList.add('hidden');
      detailsDropdown.classList.add('hidden');
    });
  }

  // Клик по плашке раскрывает/скрывает выпадающий список подробностей
  if (pillToggleArea) {
    pillToggleArea.addEventListener('click', () => {
      detailsDropdown.classList.toggle('hidden');
      const arrow = document.querySelector('.chevron-arrow');
      if (arrow) {
        arrow.style.transform = detailsDropdown.classList.contains('hidden') ? 'rotate(0deg)' : 'rotate(180deg)';
      }
    });
  }

  if (detailsCloseBtn) {
    detailsCloseBtn.addEventListener('click', () => {
      detailsDropdown.classList.add('hidden');
    });
  }

  // Переключение слоев через чипсы
  const chips = document.querySelectorAll('.layer-chip');
  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      chips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      const layer = chip.dataset.layer;
      setMtsLayer(layer);
    });
  });

  // Клик по строке в подробностях тоже переключает слой
  const techRows = document.querySelectorAll('.tech-row');
  techRows.forEach(row => {
    row.addEventListener('click', () => {
      const layer = row.dataset.layerClick;
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
