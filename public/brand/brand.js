(() => {
  const toast = document.querySelector('#toast');
  let toastTimer;
  function notify(message) {
    clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add('visible');
    toastTimer = setTimeout(() => toast.classList.remove('visible'), 3200);
  }
  document.querySelectorAll('[data-surface]').forEach(button => {
    button.addEventListener('click', () => {
      const dark = button.dataset.surface === 'dark';
      document.querySelector('#logo-field').classList.toggle('is-dark', dark);
      document.querySelector('#logo-field img').src = dark ? './logo-reporta-dark.svg' : './logo-reporta.svg';
      document.querySelector('.specimen-top > .meta').textContent = dark ? 'Вектор / Тёмная поверхность' : 'Вектор / Прозрачный фон';
      document.querySelectorAll('[data-surface]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    });
  });
  const semanticPreview = document.querySelector('#semantic-preview');
  document.querySelectorAll('.semantic-row').forEach(row => {
    const token = document.createElement('button');
    token.className = 'semantic-token';
    token.dataset.role = 'solid';
    token.append(document.createElement('i'), document.createElement('code'));
    row.querySelector('.semantic-example').after(token);
  });
  function updateSemanticTokens() {
    const styles = getComputedStyle(semanticPreview);
    document.querySelectorAll('.semantic-token').forEach(button => {
      const tone = button.closest('[data-tone]').dataset.tone;
      const token = `--reporta-${tone}-${button.dataset.role}`;
      const value = styles.getPropertyValue(token).trim().toUpperCase();
      button.style.setProperty('--token-color', value);
      button.dataset.copy = value;
      button.querySelector('code').textContent = value;
      button.setAttribute('aria-label', `Скопировать ${token}: ${value}`);
      button.title = `${token}: ${value}`;
    });
  }
  updateSemanticTokens();
  document.querySelectorAll('[data-semantic-theme]').forEach(button => {
    button.addEventListener('click', () => {
      semanticPreview.dataset.reportaTheme = button.dataset.semanticTheme;
      document.querySelectorAll('[data-semantic-theme]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
      updateSemanticTokens();
    });
  });
  document.querySelectorAll('[data-copy]').forEach(button => {
    button.addEventListener('click', async () => {
      const value = button.dataset.copy;
      try {
        if (!navigator.clipboard) throw new Error('Clipboard unavailable');
        await navigator.clipboard.writeText(value);
        notify(`${value} скопирован`);
      } catch {
        notify(`Цвет: ${value}. Выделите код под образцом, чтобы скопировать вручную.`);
      }
    });
  });
  const artLibrary = document.querySelector('#art-library');
  const artDialog = document.querySelector('#art-dialog');
  function setArtTheme(theme) {
    artLibrary.dataset.galleryTheme = theme;
    document.querySelectorAll('[data-art-image]').forEach(image => {
      image.src = `./illustrations/preview/${image.dataset.artImage}-${theme}.webp`;
    });
    document.querySelectorAll('[data-art-theme]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.artTheme === theme)));
  }
  document.querySelectorAll('[data-art-theme]').forEach(button => button.addEventListener('click', () => setArtTheme(button.dataset.artTheme)));
  document.querySelector('#art-checker').addEventListener('change', event => {
    artLibrary.classList.toggle('show-checker', event.target.checked);
    document.querySelector('.art-dialog-stage').classList.toggle('show-checker', event.target.checked);
  });
  function setArtDialogTheme(theme) {
    document.querySelector('.art-dialog-stage').dataset.galleryTheme = theme;
    document.querySelector('#art-dialog-image').src = `./illustrations/${theme}/${artDialog.dataset.artId}.png`;
    document.querySelector('#art-dialog-theme').setAttribute('aria-pressed', String(theme === 'dark'));
  }
  document.querySelectorAll('[data-art-open]').forEach(button => button.addEventListener('click', () => {
    const figure = button.closest('figure');
    const id = button.dataset.artOpen;
    artDialog.dataset.artId = id;
    document.querySelector('#art-dialog-title').textContent = figure.querySelector('b').textContent;
    document.querySelector('#art-dialog-meaning').textContent = figure.querySelector('small').textContent;
    document.querySelector('#art-dialog-image').alt = figure.querySelector('[data-art-image]').alt;
    document.querySelector('#art-dialog-light').href = `./illustrations/light/${id}.png`;
    document.querySelector('#art-dialog-dark').href = `./illustrations/dark/${id}.png`;
    setArtDialogTheme(artLibrary.dataset.galleryTheme);
    artDialog.showModal();
  }));
  document.querySelector('#art-dialog-theme').addEventListener('click', () => {
    setArtDialogTheme(document.querySelector('.art-dialog-stage').dataset.galleryTheme === 'dark' ? 'light' : 'dark');
  });
  document.querySelectorAll('.bookmark').forEach(button => {
    button.addEventListener('click', () => {
      const saved = button.getAttribute('aria-pressed') !== 'true';
      button.setAttribute('aria-pressed', String(saved));
      button.setAttribute('aria-label', saved ? 'Убрать историю из сохранённого' : 'Сохранить историю');
      button.title = saved ? 'Убрать из сохранённого' : 'Сохранить';
      button.querySelector('img').src = saved ? './icons/check.svg' : './icons/bookmark.svg';
      notify(saved ? 'Сохранено в демонстрационном выпуске' : 'Убрано из сохранённого');
    });
  });
  const articleDialog = document.querySelector('#article-dialog');
  function openArticle(city = false) {
    document.querySelector('#article-title').textContent = city ? 'Город, который замечаешь заново' : 'Что остаётся после прочитанного';
    document.querySelector('#article-text').textContent = city
      ? 'На знакомом маршруте легко перестать смотреть по сторонам. Попробуйте заметить одну деталь: вывеску, форму окна, новый столик у кафе. У города тоже есть свой выпуск, только его никто не собирает за вас.'
      : 'Попробуйте оставить от сегодняшнего чтения одну мысль. Не самый громкий заголовок, а то, к чему хочется вернуться. Запишите её своими словами. Иногда именно эта пауза превращает поток новостей в собственную картину мира.';
    articleDialog.showModal();
  }
  document.querySelectorAll('[data-open-article]').forEach(button => button.addEventListener('click', () => openArticle(button.dataset.openArticle === 'city')));
  document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
  document.querySelectorAll('dialog').forEach(dialog => {
    dialog.addEventListener('click', event => {
      const rect = dialog.getBoundingClientRect();
      if (event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) dialog.close();
    });
  });
  const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
  const motionEnabled = document.querySelector('#motion-enabled');
  const replay = document.querySelector('#replay');
  const motionMark = document.querySelector('.motion-mark');
  let animationFrame;
  function applyMotionPreference() {
    motionEnabled.checked = !motionPreference.matches;
    motionEnabled.disabled = motionPreference.matches;
    replay.disabled = !motionEnabled.checked;
    if (!motionEnabled.checked) motionMark.classList.remove('reporta-arrive');
    document.querySelector('#motion-note').textContent = motionPreference.matches
      ? 'Анимация отключена системной настройкой уменьшения движения.'
      : 'Системная настройка уменьшения движения отключает анимацию. Геометрия знака остаётся неизменной.';
  }
  function playMotion() {
    if (!motionEnabled.checked || motionPreference.matches) return;
    cancelAnimationFrame(animationFrame);
    motionMark.classList.remove('reporta-arrive');
    animationFrame = requestAnimationFrame(() => {
      void motionMark.offsetWidth;
      motionMark.classList.add('reporta-arrive');
    });
  }
  applyMotionPreference();
  motionPreference.addEventListener('change', applyMotionPreference);
  motionEnabled.addEventListener('change', () => {
    replay.disabled = !motionEnabled.checked;
    motionMark.classList.remove('reporta-arrive');
    if (motionEnabled.checked) playMotion();
  });
  replay.addEventListener('click', playMotion);
  const observer = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) {
      playMotion();
      observer.disconnect();
    }
  }, { threshold: .6 });
  observer.observe(document.querySelector('#motion-stage'));
  const artDescriptions = {
    mono: 'Монохром для читалки и одноцветной печати. Смысл держится на форме.',
    signal: 'Основная версия: из потока чёрно-белых газет выходит одна красная.',
    iris: 'Та же метафора на голубом поле. Красный по-прежнему показывает выбранное.',
  };
  document.querySelectorAll('[name="art-mode"]').forEach(input => input.addEventListener('change', () => {
    document.querySelector('.art-composition').dataset.artMode = input.value;
    document.querySelector('#art-caption').textContent = artDescriptions[input.value];
  }));
  const states = {
    loading: { title: 'Собираем ваш выпуск', copy: 'Сверяем источники и объединяем повторяющиеся сюжеты.' },
    empty: { title: 'С чего начнём?', copy: 'Добавьте первый источник. Хороший выпуск начинается с вашего выбора.', action: 'Добавить источник', icon: 'plus' },
    found: { title: 'Есть на что посмотреть', copy: 'Новая история из ваших источников. Откройте, когда будет время.', action: 'Открыть историю', icon: 'arrow' },
    export: { title: 'Можно читать без сети', copy: 'Демонстрационный выпуск готов к скачиванию в текстовом формате.', action: 'Скачать пример .txt', icon: 'download' },
  };
  let currentState = 'loading';
  const stateAction = document.querySelector('#state-action');
  const tabs = [...document.querySelectorAll('[data-state]')];
  function setState(name) {
    currentState = name;
    const state = states[name];
    tabs.forEach(tab => {
      const selected = tab.dataset.state === name;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    document.querySelector('#state-panel').setAttribute('aria-labelledby', `tab-${name}`);
    document.querySelector('#state-title').textContent = state.title;
    document.querySelector('#state-copy').textContent = state.copy;
    document.querySelector('#state-progress').hidden = name !== 'loading';
    stateAction.hidden = !state.action;
    if (state.action) {
      stateAction.querySelector('span').textContent = state.action;
      stateAction.querySelector('img').src = `./icons/${state.icon}.svg`;
    }
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => setState(tab.dataset.state));
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      else if (event.key === 'ArrowLeft') next = (index + tabs.length - 1) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      else return;
      event.preventDefault();
      setState(tabs[next].dataset.state);
      tabs[next].focus();
    });
  });
  stateAction.addEventListener('click', () => {
    if (currentState === 'empty') document.querySelector('#source-dialog').showModal();
    if (currentState === 'found') openArticle();
    if (currentState === 'export') {
      const text = 'REPORTA / Демонстрационный выпуск 024\n\nЧто остаётся после прочитанного\n\nПопробуйте оставить от сегодняшнего чтения одну мысль. Запишите её своими словами и вернитесь к ней вечером.\n\nГород, который замечаешь заново\n\nНа знакомом маршруте заметьте одну новую деталь: вывеску, окно или столик у кафе.\n\nЭто демонстрационные редакционные тексты, не реальные новости.\n';
      const url = URL.createObjectURL(new Blob(['\ufeff', text], { type: 'text/plain;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'reporta-demo-024.txt';
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify('Демонстрационный выпуск скачивается');
    }
  });
  document.querySelector('#source-form').addEventListener('submit', event => {
    event.preventDefault();
    const input = document.querySelector('#source-url');
    const url = new URL(input.value);
    if (!['https:', 'http:'].includes(url.protocol)) {
      input.setCustomValidity('Используйте адрес, начинающийся с https:// или http://');
      input.reportValidity();
      return;
    }
    document.querySelector('#source-dialog').close();
    setState('found');
    document.querySelector('#state-copy').textContent = `Источник ${url.hostname} добавлен в пример. Реальные настройки не изменены.`;
    notify('Источник добавлен в демонстрацию');
  });
  document.querySelector('#source-url').addEventListener('input', event => event.target.setCustomValidity(''));
  document.querySelectorAll('[name="crop"]').forEach(input => input.addEventListener('change', () => {
    document.querySelector('.photo-frame').dataset.crop = input.value;
  }));
})();
