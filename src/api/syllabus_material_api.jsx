import {
  RAW_GET_MATERIAL_DETAIL_INFO_RESPONSE_BY_MATERIAL_ID,
  RAW_GET_MATERIAL_DRAFT_DETAIL_INFO_RESPONSE_BY_MATERIAL_ID,
  RAW_GET_MATERIAL_STATUS_RESPONSE_BY_MATERIAL_ID,
  RAW_GET_SYLLABUS_DETAIL_INFO_RESPONSE_BY_SYLLABUS_ID_FOR_USER_7_MANAGE_VIEW,
  RAW_GET_SYLLABUS_DRAFT_DETAIL_INFO_RESPONSE_BY_SYLLABUS_ID_FOR_USER_7_MANAGE_VIEW,
  RAW_GET_SYLLABUS_STATUS_RESPONSE_BY_SYLLABUS_ID_FOR_USER_7_MANAGE_VIEW,
  RAW_LIST_ALL_SYLLABUSES_BRIEF_INFO_FOR_MANAGE_RESPONSE_FOR_USER_7,
  RAW_LIST_MATERIALS_BRIEF_INFO_RESPONSE_BY_SYLLABUS_ID,
} from './mock_payloads';
import { listGraphFiles, listSyllabusFiles } from './file_transmit_api';
import { getJobLabel, getJobTone, listJobs } from './job_api';

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

function createInitialGraphStore() {
  const rows = Array.isArray(RAW_LIST_ALL_SYLLABUSES_BRIEF_INFO_FOR_MANAGE_RESPONSE_FOR_USER_7?.syllabuses)
    ? RAW_LIST_ALL_SYLLABUSES_BRIEF_INFO_FOR_MANAGE_RESPONSE_FOR_USER_7.syllabuses
    : [];

  return rows
    .filter((row) => row.graph_id != null && row.graph_name)
    .map((row) => ({
      graph_id: row.graph_id,
      graph_name: row.graph_name,
    }));
}

let mockGraphStore = createInitialGraphStore();
let mockUploadedSyllabusIdSeed = Math.max(
  0,
  ...((RAW_LIST_ALL_SYLLABUSES_BRIEF_INFO_FOR_MANAGE_RESPONSE_FOR_USER_7?.syllabuses ?? []).map((row) => row.syllabus_id ?? 0)),
);
let mockSyllabusDetailResponseById = cloneData(RAW_GET_SYLLABUS_DETAIL_INFO_RESPONSE_BY_SYLLABUS_ID_FOR_USER_7_MANAGE_VIEW);
let mockSyllabusDraftDetailResponseById = cloneData(RAW_GET_SYLLABUS_DRAFT_DETAIL_INFO_RESPONSE_BY_SYLLABUS_ID_FOR_USER_7_MANAGE_VIEW);
let mockMaterialDetailResponseById = cloneData(RAW_GET_MATERIAL_DETAIL_INFO_RESPONSE_BY_MATERIAL_ID);
let mockMaterialDraftDetailResponseById = cloneData(RAW_GET_MATERIAL_DRAFT_DETAIL_INFO_RESPONSE_BY_MATERIAL_ID);

function updateManageSyllabusTitle(syllabusId, title) {
  const rows = RAW_LIST_ALL_SYLLABUSES_BRIEF_INFO_FOR_MANAGE_RESPONSE_FOR_USER_7?.syllabuses ?? [];
  const target = rows.find((row) => row.syllabus_id === syllabusId);
  if (target) {
    target.title = title;
  }
}

function updateMaterialBriefTitle(materialId, title) {
  Object.values(RAW_LIST_MATERIALS_BRIEF_INFO_RESPONSE_BY_SYLLABUS_ID).forEach((response) => {
    const rows = response?.materials ?? [];
    const target = rows.find((row) => row.material_id === materialId);
    if (target) {
      target.title = title;
    }
  });
}

function parseSyllabusStatusResponse(response) {
  return {
    isEduCalendarMissing: Boolean(response?.status?.is_edu_calendar_path_null),
    isDraftMissing: Boolean(response?.status?.is_syllabus_draft_path_null),
    isFinalMissing: Boolean(response?.status?.is_syllabus_path_null),
  };
}

function parseMaterialStatusResponse(response) {
  return {
    isDraftMissing: Boolean(response?.status?.is_material_draft_path_null),
    isFinalMissing: Boolean(response?.status?.is_material_path_null),
  };
}

function parseSyllabusListResponse(response) {
  const rows = Array.isArray(response?.syllabuses) ? response.syllabuses : [];

  return rows.map((row) => ({
    syllabusId: row.syllabus_id,
    title: row.title,
    permission: row.syllabus_permission,
    graphId: row.graph_id,
    graphName: row.graph_name,
    dayOneTime: row.day_one_time,
    eduCalendarPath: row.edu_calendar_path,
    draftPath: row.syllabus_draft_path,
    finalPath: row.syllabus_path,
  }));
}

function parseSyllabusDetailResponse(response) {
  return response?.syllabus ?? null;
}

function parseSyllabusDraftDetailResponse(response) {
  return response?.syllabus_draft ?? null;
}

function parseMaterialListResponse(response) {
  const rows = Array.isArray(response?.materials) ? response.materials : [];

  return rows.map((row) => ({
    materialId: row.material_id,
    title: row.title,
    draftPath: row.draft_path,
    finalPath: row.final_path,
    pdfPath: row.pdf_path,
    createTime: row.create_time,
  }));
}

function parseMaterialDetailResponse(response) {
  return response?.material ?? null;
}

function parseMaterialDraftResponse(response) {
  return response?.material ?? null;
}

function parseSyllabusMutationResponse(response) {
  return {
    success: Boolean(response?.success),
    syllabusId: response?.syllabus?.syllabus_id ?? null,
    fileId: response?.file?.file_id ?? null,
    errorMessage: response?.error_message ?? '',
    errorCode: response?.error_code ?? '',
  };
}

function parseGraphListResponse(response) {
  const rows = Array.isArray(response?.graphs) ? response.graphs : [];

  return rows.map((row) => ({
    graphId: row.graph_id,
    graphName: row.graph_name,
  }));
}

function parseGraphMutationResponse(response) {
  return {
    success: Boolean(response?.success),
    graphId: response?.graph?.graph_id ?? null,
    graphName: response?.graph?.graph_name ?? '',
    errorMessage: response?.error_message ?? '',
    errorCode: response?.error_code ?? '',
  };
}

function parseMaterialMutationResponse(response) {
  return {
    success: Boolean(response?.success),
    materialId: response?.material?.material_id ?? null,
    errorMessage: response?.error_message ?? '',
    errorCode: response?.error_code ?? '',
  };
}

function createSuccessSyllabusMutation(syllabusId) {
  return {
    success: true,
    syllabus: { syllabus_id: syllabusId ?? null },
    error_message: '',
    error_code: '',
  };
}

function createSuccessMaterialMutation(materialId) {
  return {
    success: true,
    material: { material_id: materialId ?? null },
    error_message: '',
    error_code: '',
  };
}

function ensureSyllabusDraftJson(value) {
  return (
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof value.title === 'string'
    && 'graph_name' in value
    && Array.isArray(value.period)
  );
}

function ensureSyllabusJson(value) {
  return (
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof value.title === 'string'
    && 'graph_name' in value
    && typeof value.day_one === 'string'
    && Array.isArray(value.period)
  );
}

function ensureMaterialJson(value) {
  return (
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof value.material_title === 'string'
    && Array.isArray(value.involved_weeks)
    && Array.isArray(value.questions)
  );
}

function mapGraphFiles(graphFiles, jobs) {
  return graphFiles.map((file) => {
    const job = jobs.find((item) => item.fileId === file.fileId) ?? null;

    return {
      fileId: file.fileId,
      title: file.title,
      source: file.source,
      weekLabel: file.weekIndexList.length ? `第 ${file.weekIndexList.join(', ')} 周` : '',
      tagText: job ? getJobLabel(job) : '',
      tagTone: job ? getJobTone(job.status) : 'neutral',
      job,
    };
  });
}

function mapMaterialShelf(syllabusFiles, graphFiles) {
  const syllabusItems = syllabusFiles.map((file) => ({
    fileId: file.fileId,
    title: file.title,
    source: file.source,
    weekLabel: file.weekIndexList.length ? `第 ${file.weekIndexList.join(', ')} 周` : '',
  }));

  return [...syllabusItems, ...graphFiles];
}

export async function listSyllabusesRaw() {
  return cloneData(RAW_LIST_ALL_SYLLABUSES_BRIEF_INFO_FOR_MANAGE_RESPONSE_FOR_USER_7);
}

export async function getSyllabusDetailRaw(syllabusId) {
  return cloneData(mockSyllabusDetailResponseById[syllabusId]);
}

export async function getSyllabusDraftDetailRaw(syllabusId) {
  return cloneData(mockSyllabusDraftDetailResponseById[syllabusId]);
}

export async function getSyllabusStatusRaw(syllabusId) {
  return cloneData(RAW_GET_SYLLABUS_STATUS_RESPONSE_BY_SYLLABUS_ID_FOR_USER_7_MANAGE_VIEW[syllabusId]);
}

export async function listMaterialsRaw(syllabusId) {
  return cloneData(RAW_LIST_MATERIALS_BRIEF_INFO_RESPONSE_BY_SYLLABUS_ID[syllabusId] ?? { success: true, materials: [] });
}

export async function getMaterialDraftDetailRaw(materialId) {
  return cloneData(mockMaterialDraftDetailResponseById[materialId] ?? { success: true, material: null });
}

export async function getMaterialDetailRaw(materialId) {
  return cloneData(mockMaterialDetailResponseById[materialId] ?? { success: true, material: null });
}

export async function getMaterialStatusRaw(materialId) {
  return cloneData(
    RAW_GET_MATERIAL_STATUS_RESPONSE_BY_MATERIAL_ID[materialId] ?? {
      success: true,
      status: {
        is_material_draft_path_null: true,
        is_material_path_null: true,
      },
      error_message: '',
      error_code: '',
    },
  );
}

export async function getTeacherDashboardData() {
  const syllabusList = parseSyllabusListResponse(await listSyllabusesRaw());

  const syllabuses = await Promise.all(
    syllabusList.map(async (item) => {
      const finalData = item.finalPath ? parseSyllabusDetailResponse(await getSyllabusDetailRaw(item.syllabusId)) : null;
      const draft = item.draftPath ? parseSyllabusDraftDetailResponse(await getSyllabusDraftDetailRaw(item.syllabusId)) : null;
      const status = parseSyllabusStatusResponse(await getSyllabusStatusRaw(item.syllabusId));
      const rawGraphFiles = await listGraphFiles(item.graphId ? [item.graphId] : []);
      const jobs = item.graphId ? await listJobs(item.graphId) : [];
      const graphFiles = mapGraphFiles(rawGraphFiles, jobs);
      const syllabusFiles = await listSyllabusFiles([item.syllabusId]);
      const materialList = parseMaterialListResponse(await listMaterialsRaw(item.syllabusId));

      const materialDrafts = await Promise.all(
        materialList.map(async (material) => ({
          ...material,
          draft: parseMaterialDraftResponse(await getMaterialDraftDetailRaw(material.materialId)),
          finalData: material.finalPath ? parseMaterialDetailResponse(await getMaterialDetailRaw(material.materialId)) : null,
          status: parseMaterialStatusResponse(await getMaterialStatusRaw(material.materialId)),
        })),
      );

      return {
        syllabusId: item.syllabusId,
        title: finalData?.title ?? draft?.title ?? item.title,
        permission: item.permission,
        graphId: item.graphId,
        graphName: finalData?.graph_name ?? item.graphName,
        dayOneTime: item.dayOneTime,
        status,
        draft,
        finalData,
        graphFiles,
        graphFileCount: graphFiles.filter((file) => !file.job || file.job.status !== 'failed').length,
        syllabusFiles,
        materialDrafts,
        materialShelf: mapMaterialShelf(syllabusFiles, graphFiles),
      };
    }),
  );

  return { syllabuses };
}

export async function listGraphsRaw() {
  return cloneData({
    success: true,
    graphs: mockGraphStore,
    error_message: '',
    error_code: '',
  });
}

export async function createGraphRaw(payload = {}) {
  const graphName = String(payload.graphName ?? '').trim();

  if (!graphName) {
    return {
      success: false,
      graph: null,
      error_message: 'graph_name_required',
      error_code: 'graph_name_required',
    };
  }

  const existing = mockGraphStore.find((item) => item.graph_name === graphName);
  if (existing) {
    return {
      success: true,
      graph: existing,
      error_message: '',
      error_code: '',
    };
  }

  const nextId = Math.max(0, ...mockGraphStore.map((item) => item.graph_id)) + 1;
  const graph = {
    graph_id: nextId,
    graph_name: graphName,
  };

  mockGraphStore = [...mockGraphStore, graph];

  return {
    success: true,
    graph,
    error_message: '',
    error_code: '',
  };
}

export async function listGraphs() {
  return parseGraphListResponse(await listGraphsRaw());
}

export async function createGraph(payload = {}) {
  return parseGraphMutationResponse(await createGraphRaw(payload));
}

export async function uploadCalendar() {
  mockUploadedSyllabusIdSeed += 1;

  return parseSyllabusMutationResponse({
    success: true,
    file: { file_id: 901 },
    syllabus: { syllabus_id: mockUploadedSyllabusIdSeed },
    error_message: '',
    error_code: '',
  });
}

export async function buildSyllabusDraft(payload = {}) {
  return parseSyllabusMutationResponse(createSuccessSyllabusMutation(payload.syllabusId ?? null));
}

export async function updateSyllabusDraft(payload = {}) {
  const syllabusId = payload.syllabusId ?? null;
  const syllabusDraftJson = payload.syllabusDraftJson;

  if (!syllabusId || !ensureSyllabusDraftJson(syllabusDraftJson)) {
    return parseSyllabusMutationResponse({
      success: false,
      syllabus: null,
      error_message: 'invalid_syllabus_draft_json',
      error_code: 'invalid_fields',
    });
  }

  mockSyllabusDraftDetailResponseById[syllabusId] = {
    success: true,
    syllabus_draft: cloneData(syllabusDraftJson),
    error_message: '',
    error_code: '',
  };
  updateManageSyllabusTitle(syllabusId, syllabusDraftJson.title);

  return parseSyllabusMutationResponse(createSuccessSyllabusMutation(syllabusId));
}

export async function buildSyllabus(payload = {}) {
  const syllabusId = payload.syllabusId ?? null;
  const draftPayload = mockSyllabusDraftDetailResponseById[syllabusId]?.syllabus_draft ?? null;

  if (syllabusId && draftPayload && Array.isArray(draftPayload.period)) {
    mockSyllabusDetailResponseById[syllabusId] = {
      success: true,
      syllabus: {
        title: draftPayload.title,
        day_one: '2026-03-02',
        graph_name: draftPayload.graph_name,
        period: draftPayload.period.map((item) => ({
          ...cloneData(item),
          original_content: item.content ?? '',
          enhanced_content: item.content ?? '',
        })),
      },
      error_message: '',
      error_code: '',
    };
  }

  return parseSyllabusMutationResponse(createSuccessSyllabusMutation(syllabusId));
}

export async function updateSyllabus(payload = {}) {
  const syllabusId = payload.syllabusId ?? null;
  const syllabusJson = payload.syllabusJson;

  if (!syllabusId || !ensureSyllabusJson(syllabusJson)) {
    return parseSyllabusMutationResponse({
      success: false,
      syllabus: null,
      error_message: 'invalid_syllabus_json',
      error_code: 'invalid_fields',
    });
  }

  mockSyllabusDetailResponseById[syllabusId] = {
    success: true,
    syllabus: cloneData(syllabusJson),
    error_message: '',
    error_code: '',
  };
  updateManageSyllabusTitle(syllabusId, syllabusJson.title);

  return parseSyllabusMutationResponse(createSuccessSyllabusMutation(syllabusId));
}

export async function generateMaterialDraft(payload = {}) {
  return parseMaterialMutationResponse({
    success: true,
    material: { material_id: payload.materialId ?? 101 },
    error_message: '',
    error_code: '',
  });
}

export async function updateMaterialDraft(payload = {}) {
  const materialId = payload.materialId ?? null;
  const materialDraftJson = payload.materialDraftJson;

  if (!materialId || !ensureMaterialJson(materialDraftJson)) {
    return parseMaterialMutationResponse({
      success: false,
      material: null,
      error_message: 'invalid_material_draft_json',
      error_code: 'invalid_fields',
    });
  }

  mockMaterialDraftDetailResponseById[materialId] = {
    success: true,
    material: cloneData(materialDraftJson),
    error_message: '',
    error_code: '',
  };
  updateMaterialBriefTitle(materialId, materialDraftJson.material_title);

  return parseMaterialMutationResponse(createSuccessMaterialMutation(materialId));
}

export async function generateFinalMaterial(payload = {}) {
  return parseMaterialMutationResponse({
    success: true,
    material: { material_id: payload.materialId ?? null },
    error_message: '',
    error_code: '',
  });
}

export async function updateFinalMaterial(payload = {}) {
  const materialId = payload.materialId ?? null;
  const materialJson = payload.materialJson;

  if (!materialId || !ensureMaterialJson(materialJson)) {
    return parseMaterialMutationResponse({
      success: false,
      material: null,
      error_message: 'invalid_material_json',
      error_code: 'invalid_fields',
    });
  }

  mockMaterialDetailResponseById[materialId] = {
    success: true,
    material: cloneData(materialJson),
    error_message: '',
    error_code: '',
  };
  updateMaterialBriefTitle(materialId, materialJson.material_title);

  return parseMaterialMutationResponse(createSuccessMaterialMutation(materialId));
}

export async function publishMaterial(payload = {}) {
  return parseMaterialMutationResponse({
    success: true,
    material: { material_id: payload.materialId ?? null },
    error_message: '',
    error_code: '',
  });
}

export {
  parseGraphListResponse,
  parseGraphMutationResponse,
  parseMaterialDetailResponse,
  parseMaterialDraftResponse,
  parseMaterialListResponse,
  parseMaterialMutationResponse,
  parseMaterialStatusResponse,
  parseSyllabusDraftDetailResponse,
  parseSyllabusDetailResponse,
  parseSyllabusListResponse,
  parseSyllabusMutationResponse,
  parseSyllabusStatusResponse,
};
