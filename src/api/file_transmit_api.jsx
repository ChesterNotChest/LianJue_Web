import {
  RAW_LIST_ALL_FILES_BRIEF_INFO_RESPONSE_BY_GRAPH_ID,
  RAW_LIST_ALL_FILES_BRIEF_INFO_RESPONSE_BY_SYLLABUS_ID,
} from './mock_payloads';
import { USE_MOCK_API, apiPost, fileToUploadPayload } from './client';

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

function createMockFileDetailStore() {
  const store = {};
  const pushFiles = (responseMap) => {
    Object.values(responseMap ?? {}).forEach((response) => {
      (response?.files ?? []).forEach((file) => {
        store[file.file_id] = {
          success: true,
          file: {
            file_id: file.file_id,
            filename: file.filename,
            path: file.path,
            upload_time: file.upload_time ?? null,
          },
          error_message: '',
          error_code: '',
        };
      });
    });
  };

  pushFiles(RAW_LIST_ALL_FILES_BRIEF_INFO_RESPONSE_BY_GRAPH_ID);
  pushFiles(RAW_LIST_ALL_FILES_BRIEF_INFO_RESPONSE_BY_SYLLABUS_ID);
  return store;
}

let mockFileDetailResponseById = createMockFileDetailStore();

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

function parseFileDetailResponse(response) {
  const file = response?.file ?? null;
  if (!file) {
    return null;
  }

  return {
    fileId: file.file_id,
    title: file.filename,
    path: file.path,
    uploadTime: file.upload_time ?? null,
  };
}

export async function listGraphFilesRaw(graphIdList = []) {
  if (!USE_MOCK_API) {
    return apiPost('/api/file_list_graph_files', { graph_id_list: graphIdList });
  }
  return cloneData(mergeFileResponses(RAW_LIST_ALL_FILES_BRIEF_INFO_RESPONSE_BY_GRAPH_ID, graphIdList));
}

export async function listSyllabusFilesRaw(syllabusIdList = []) {
  if (!USE_MOCK_API) {
    return apiPost('/api/file_list_syllabus_files', { syllabus_id_list: syllabusIdList });
  }
  return cloneData(mergeFileResponses(RAW_LIST_ALL_FILES_BRIEF_INFO_RESPONSE_BY_SYLLABUS_ID, syllabusIdList));
}

export async function listGraphFiles(graphIdList = []) {
  return parseFileListResponse(await listGraphFilesRaw(graphIdList));
}

export async function listSyllabusFiles(syllabusIdList = []) {
  return parseFileListResponse(await listSyllabusFilesRaw(syllabusIdList));
}

export async function getFileDetailRaw(fileId) {
  if (!USE_MOCK_API) {
    return apiPost('/api/file_detail', { file_id: fileId });
  }
  return cloneData(mockFileDetailResponseById[fileId] ?? {
    success: false,
    file: null,
    error_message: 'not_found',
    error_code: 'not_found',
  });
}

export async function getFileDetail(fileId) {
  return parseFileDetailResponse(await getFileDetailRaw(fileId));
}

export async function uploadFile(payload = {}) {
  if (!USE_MOCK_API) {
    const file = payload.file ?? payload.files?.[0] ?? null;
    const request = file
      ? await fileToUploadPayload(file, payload)
      : {
          file_name: payload.fileName ?? payload.file_name,
          file_bytes: payload.fileBytes ?? payload.file_bytes,
          upload_time: payload.uploadTime ?? payload.upload_time,
          file_type: payload.fileType ?? payload.file_type,
        };
    return apiPost('/api/file_upload', request);
  }

  const file = payload.file ?? payload.files?.[0] ?? null;
  const fileId = 900 + Date.now();
  mockFileDetailResponseById[fileId] = {
    success: true,
    file: {
      file_id: fileId,
      filename: file?.name ?? payload.fileName ?? payload.file_name ?? `file_${fileId}`,
      path: file?.name ? `./pdf/${file.name}` : `./pdf/file_${fileId}`,
      upload_time: payload.uploadTime ?? payload.upload_time ?? null,
    },
    error_message: '',
    error_code: '',
  };

  return {
    success: true,
    file: {
      file_id: fileId,
    },
    request: payload,
    error_message: '',
    error_code: '',
  };
}

export { parseFileDetailResponse, parseFileListResponse };
