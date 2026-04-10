import {
  RAW_LIST_ALL_FILES_BRIEF_INFO_RESPONSE_BY_GRAPH_ID,
  RAW_LIST_ALL_FILES_BRIEF_INFO_RESPONSE_BY_SYLLABUS_ID,
} from './mock_payloads';

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

function mergeFileResponses(sourceMap, idList = []) {
  const targetIds = idList.length ? idList : Object.keys(sourceMap).map((key) => Number(key));
  const responses = targetIds
    .map((id) => sourceMap[id])
    .filter(Boolean);

  return {
    success: responses.every((response) => response.success !== false),
    files: responses.flatMap((response) => response.files ?? []),
    error_message: responses.find((response) => response.error_message)?.error_message ?? '',
    error_code: responses.find((response) => response.error_code)?.error_code ?? '',
  };
}

function parseFileListResponse(response) {
  const files = Array.isArray(response?.files) ? response.files : [];

  return files.map((file) => ({
    fileId: file.file_id,
    title: file.filename,
    path: file.path,
    source: file.source,
    weekIndexList: Array.isArray(file.week_index_list) ? file.week_index_list : [],
  }));
}

export async function listGraphFilesRaw(graphIdList = []) {
  return cloneData(mergeFileResponses(RAW_LIST_ALL_FILES_BRIEF_INFO_RESPONSE_BY_GRAPH_ID, graphIdList));
}

export async function listSyllabusFilesRaw(syllabusIdList = []) {
  return cloneData(mergeFileResponses(RAW_LIST_ALL_FILES_BRIEF_INFO_RESPONSE_BY_SYLLABUS_ID, syllabusIdList));
}

export async function listGraphFiles(graphIdList = []) {
  return parseFileListResponse(await listGraphFilesRaw(graphIdList));
}

export async function listSyllabusFiles(syllabusIdList = []) {
  return parseFileListResponse(await listSyllabusFilesRaw(syllabusIdList));
}

export async function uploadFile(payload = {}) {
  return {
    success: true,
    file: {
      file_id: 900 + Date.now(),
    },
    request: payload,
    error_message: '',
    error_code: '',
  };
}

export { parseFileListResponse };
