import { DEFAULT_CONFIG, MSG } from '../utils/constants.js';
import { sendRuntimeMessage } from '../utils/browserApi.js';
import { formatWatcherLines } from '../utils/pageDataUtils.js';

const form = document.getElementById('optionsForm');
const urlFilters = document.getElementById('urlFilters');
const correlationHeaders = document.getElementById('correlationHeaders');
const pageDataWatchers = document.getElementById('pageDataWatchers');
const reportRecipients = document.getElementById('reportRecipients');
const maxEvents = document.getElementById('maxEvents');
const retentionHours = document.getElementById('retentionHours');
const pageDataPollMs = document.getElementById('pageDataPollMs');
const pageDataDurationSeconds = document.getElementById('pageDataDurationSeconds');
const btnReset = document.getElementById('btnReset');
const statusText = document.getElementById('statusText');

loadOptions();

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  await saveOptions(readForm());
});

btnReset.addEventListener('click', async () => {
  fillForm(DEFAULT_CONFIG);
  await saveOptions(DEFAULT_CONFIG);
});

async function loadOptions() {
  setStatus('Loading...');
  try {
    const response = await sendRuntimeMessage({ type: MSG.GET_CONFIG });
    fillForm(response && response.success ? response.data : DEFAULT_CONFIG);
    setStatus('Ready');
  } catch (err) {
    fillForm(DEFAULT_CONFIG);
    setStatus('Using defaults');
  }
}

async function saveOptions(config) {
  setStatus('Saving...');
  const response = await sendRuntimeMessage({ type: MSG.SAVE_CONFIG, config });
  if (response && response.success) {
    fillForm(response.data);
    setStatus('Saved');
  } else {
    setStatus('Save failed');
  }
}

function readForm() {
  return {
    urlFilters: urlFilters.value.split('\n'),
    correlationHeaders: correlationHeaders.value.split('\n'),
    pageDataWatchers: pageDataWatchers.value.split('\n'),
    pageDataPollMs: pageDataPollMs.value,
    pageDataDurationSeconds: pageDataDurationSeconds.value,
    reportRecipients: reportRecipients.value.split('\n'),
    maxEvents: maxEvents.value,
    retentionHours: retentionHours.value,
  };
}

function fillForm(config) {
  urlFilters.value = config.urlFilters.join('\n');
  correlationHeaders.value = config.correlationHeaders.join('\n');
  pageDataWatchers.value = formatWatcherLines(config.pageDataWatchers || []);
  reportRecipients.value = (config.reportRecipients || []).join('\n');
  pageDataPollMs.value = config.pageDataPollMs;
  pageDataDurationSeconds.value = config.pageDataDurationSeconds;
  maxEvents.value = config.maxEvents;
  retentionHours.value = config.retentionHours;
}

function setStatus(text) {
  statusText.textContent = text;
}