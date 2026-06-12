import {
  RAW_ASK_QUESTION_RESPONSE_FOR_USER_7_SYLLABUS_1,
  RAW_GET_PERSONAL_SYLLABUS_DETAIL_INFO_RESPONSE_BY_SYLLABUS_ID_FOR_USER_7,
  RAW_LIST_ALL_SYLLABUSES_BRIEF_INFO_FOR_LEARNING_RESPONSE_FOR_USER_7,
} from './mock_payloads';
import externalInitPersonalSyllabusResponse from '../../../mock/learning_profile/learning_init_personal_syllabus.response.json';
import externalPersonalSyllabusResponse from '../../../mock/learning_profile/learning_personal_syllabus_detail.response.json';
import externalUserLearningProfileResponse from '../../../mock/learning_profile/user_learning_profile.response.json';
import externalStudyGraphResponse from '../../../mock/study_graph/learning_study_graph.response.json';
import {
  USE_MOCK_API,
  USE_MOCK_STUDENT_SYLLABUS_LIST,
  apiGet,
  apiPost,
} from './client';
import { getFileDetail, listSyllabusFiles } from './file_transmit_api';
import { getCurrentUserId, requireUserId } from './session';

const RECOMMENDATION_STORAGE_PREFIX = 'student_recommendations_v1';
const RECOMMENDATION_EXPIRE_ASKS = 5;
const EXTERNAL_MOCK_DAY_ONE_TIME = '2026-03-02T00:00:00';

function cloneData(value) {
  if (value === undefined || value === null) {
    return value;
  }
  if (typeof value !== 'object') {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function getExternalMockSyllabusId() {
  return Number(
    externalPersonalSyllabusResponse?.syllabus?.syllabus_id
      ?? externalUserLearningProfileResponse?.profile?.syllabus_id
      ?? externalInitPersonalSyllabusResponse?.syllabus?.syllabus_id
      ?? 20036,
  );
}

function createExternalMockStudentSyllabusListResponse() {
  const profile = externalUserLearningProfileResponse?.profile ?? {};
  const scopeItem = Array.isArray(profile?.syllabus_scope) ? profile.syllabus_scope[0] ?? {} : {};
  const syllabus = externalPersonalSyllabusResponse?.syllabus ?? {};

  return {
    success: true,
    syllabuses: [
      {
        syllabus_id: getExternalMockSyllabusId(),
        title: scopeItem?.title ?? profile?.subject_title ?? syllabus?.title ?? '大数据概论',
        isLearning: true,
        personal_syllabus_path: (
          scopeItem?.personal_syllabus_path
          ?? externalInitPersonalSyllabusResponse?.syllabus?.personal_syllabus_path
          ?? null
        ),
        day_one_time: EXTERNAL_MOCK_DAY_ONE_TIME,
      },
    ],
    error_message: '',
    error_code: '',
  };
}

function createExternalMockPersonalSyllabusResponse(syllabusId) {
  if (Number(syllabusId) !== getExternalMockSyllabusId()) {
    return {
      success: true,
      syllabus: null,
      error_message: '',
      error_code: '',
    };
  }

  return cloneData(externalPersonalSyllabusResponse);
}

function createExternalMockLearningProfileResponse(syllabusId) {
  if (Number(syllabusId) !== getExternalMockSyllabusId()) {
    return {
      success: true,
      profile: null,
      error_message: '',
      error_code: '',
    };
  }

  return cloneData(externalUserLearningProfileResponse);
}

function createExternalMockStudyGraphResponse(syllabusId) {
  if (Number(syllabusId) !== getExternalMockSyllabusId()) {
    return {
      success: true,
      tree: null,
      features: null,
      error_message: '',
      error_code: '',
    };
  }

  return cloneData(externalStudyGraphResponse);
}

function parseStudentSyllabusListResponse(response) {
  const rows = Array.isArray(response?.syllabuses) ? response.syllabuses : [];

  return rows.map((row) => ({
    syllabusId: row.syllabus_id,
    title: row.title,
    isLearning: Boolean(row.isLearning),
    personalSyllabusPath: row.personal_syllabus_path,
    dayOneTime: row.day_one_time,
  }));
}

function parsePersonalSyllabusResponse(response) {
  return response?.syllabus ?? response?.personal_syllabus ?? null;
}

function normalizeGeneratedResourceType(value) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'document') {
    return 'documents';
  }
  if (normalized === 'mind_map') {
    return 'mindmap';
  }
  if (normalized === 'practice' || normalized === 'code') {
    return 'coding_practice';
  }
  return normalized;
}

function parseTotalAgentResourceSummary(item = {}) {
  return {
    resourceId: item.resource_id ?? '',
    resourceType: normalizeGeneratedResourceType(item.resource_type ?? ''),
    title: item.title ?? '',
    topic: item.topic ?? '',
    syllabusId: item.syllabus_id ?? null,
    status: item.status ?? '',
    resourceDir: item.resource_dir ?? '',
    mainFiles: typeof item.main_files === 'object' && item.main_files ? item.main_files : {},
    validation: typeof item.validation === 'object' && item.validation ? item.validation : {},
    metadata: typeof item.metadata === 'object' && item.metadata ? item.metadata : {},
    createdAt: item.created_at ?? null,
    updatedAt: item.updated_at ?? null,
    success: item.success !== false,
    errorMessage: item.error_message ?? '',
    errorCode: item.error_code ?? '',
  };
}

function normalizeTotalAgentRecommendation(source = {}) {
  const recommendation = typeof source?.recommendation === 'object' && source.recommendation
    ? source.recommendation
    : source;

  return {
    success: Boolean(recommendation?.success ?? source?.success),
    graph: {
      nodes: Array.isArray(recommendation?.graph?.nodes) ? recommendation.graph.nodes : [],
      edges: Array.isArray(recommendation?.graph?.edges) ? recommendation.graph.edges : [],
    },
    candidates: Array.isArray(recommendation?.candidates) ? recommendation.candidates : [],
    selected: Array.isArray(recommendation?.selected) ? recommendation.selected : [],
    bestPath: recommendation?.best_path ?? null,
    errorMessage: recommendation?.error_message ?? source?.error_message ?? '',
    errorCode: recommendation?.error_code ?? source?.error_code ?? '',
    meta: recommendation?.meta ?? null,
  };
}

function buildTotalAgentAnswerText(intent, result = {}) {
  const recommendation = normalizeTotalAgentRecommendation(result.recommendation);
  const retryRecommendation = normalizeTotalAgentRecommendation(result.recommendation_retry);
  const effectiveRecommendation = recommendation.candidates.length || recommendation.bestPath
    ? recommendation
    : retryRecommendation;
  const acceptResult = typeof result?.accept_learning_plan === 'object' && result.accept_learning_plan
    ? result.accept_learning_plan
    : {};
  const nextTask = result?.next_task?.next_task ?? result?.resource_generation?.next_task ?? {};
  const resources = Array.isArray(result?.resource_generation?.resources) ? result.resource_generation.resources : [];

  if (intent === 'answer_learning_question') {
    return result?.answer_learning_question?.answer?.text ?? '';
  }

  if (intent === 'recommend_learning_path') {
    if (effectiveRecommendation?.bestPath?.path?.length) {
      return '已经识别出当前学习意图，并给出一条可采纳的学习路径。你可以先查看推荐区，再决定是否采纳。';
    }
    return '你的学习目标还不够清晰，当前没有稳定的推荐路径，建议补充更具体的知识点或目标。';
  }

  if (intent === 'accept_recommendation') {
    if (acceptResult?.accepted) {
      const nextTitle = nextTask?.title ?? nextTask?.node_id ?? '当前步骤';
      return `推荐路径已采纳，接下来可以从“${nextTitle}”开始。`;
    }
    return '当前推荐还未正式采纳，可以确认后继续推进。';
  }

  if (intent === 'generate_current_step_resource') {
    if (resources.length) {
      const nextTitle = nextTask?.title ?? nextTask?.node_id ?? '当前步骤';
      return `已围绕“${nextTitle}”生成 ${resources.length} 份学习资源，你可以在资源区查看。`;
    }
    return '当前步骤已识别，但暂时没有成功生成资源。';
  }

  if (intent === 'record_learning_feedback') {
    const nextTitle = nextTask?.title ?? nextTask?.node_id ?? '';
    return nextTitle
      ? `学习反馈已记录，系统已经把你推进到下一步“${nextTitle}”。`
      : '学习反馈已记录，当前计划状态已经更新。';
  }

  if (intent === 'skip_current_step') {
    const nextTitle = nextTask?.title ?? nextTask?.node_id ?? '';
    return nextTitle
      ? `当前步骤已跳过，系统已切换到下一步“${nextTitle}”。`
      : '当前步骤已跳过。';
  }

  if (intent === 'ask_goal_clarification') {
    return '当前意图还不够明确。请补充你想学的知识点、目标、课程周次，或直接说“推荐路径”“继续学习”。';
  }

  return '';
}

function parseAskQuestionResponse(response) {
  const result = typeof response?.result === 'object' && response.result ? response.result : {};
  const answerPayload = typeof result?.answer_learning_question?.answer === 'object' && result.answer_learning_question.answer
    ? result.answer_learning_question.answer
    : {};
  const recommendation = normalizeTotalAgentRecommendation(result?.recommendation);
  const retryRecommendation = normalizeTotalAgentRecommendation(result?.recommendation_retry);
  const effectiveRecommendation = recommendation.candidates.length || recommendation.bestPath ? recommendation : retryRecommendation;
  const resourceGeneration = typeof result?.resource_generation === 'object' && result.resource_generation
    ? result.resource_generation
    : {};
  const generatedResources = Array.isArray(resourceGeneration?.resources)
    ? resourceGeneration.resources.map(parseTotalAgentResourceSummary)
    : [];
  const answerText = answerPayload?.text || buildTotalAgentAnswerText(response?.intent, result);

  return {
    success: Boolean(response?.success),
    intent: response?.intent ?? '',
    answer: answerText,
    answerPayload: {
      questionType: answerPayload?.question_type ?? '',
      text: answerText,
      keyPoints: Array.isArray(answerPayload?.key_points) ? answerPayload.key_points : [],
      evidenceUsed: Array.isArray(answerPayload?.evidence_used) ? answerPayload.evidence_used : [],
      planReference: typeof answerPayload?.plan_reference === 'object' && answerPayload.plan_reference ? answerPayload.plan_reference : {},
      relevantWeakPoints: Array.isArray(answerPayload?.relevant_weak_points) ? answerPayload.relevant_weak_points : [],
      filteredWeakPoints: Array.isArray(answerPayload?.filtered_weak_points) ? answerPayload.filtered_weak_points : [],
      nextActions: Array.isArray(answerPayload?.next_actions) ? answerPayload.next_actions : [],
      confidence: Number(answerPayload?.confidence ?? 0) || 0,
      tone: typeof answerPayload?.tone === 'object' && answerPayload.tone ? answerPayload.tone : {},
      warnings: Array.isArray(answerPayload?.warnings) ? answerPayload.warnings : [],
    },
    nextActions: Array.isArray(answerPayload?.next_actions) ? answerPayload.next_actions : [],
    suggestedNextAction: response?.suggested_next_action ?? '',
    matchedFiles: [],
    competanceList: [],
    toolTrace: Array.isArray(response?.tool_trace) ? response.tool_trace : [],
    toolStatusEvents: Array.isArray(response?.tool_status_events) ? response.tool_status_events : [],
    recommendation: effectiveRecommendation,
    recommendationTool: typeof result?.recommendation === 'object' && result.recommendation ? result.recommendation : null,
    recommendationRetryTool: typeof result?.recommendation_retry === 'object' && result.recommendation_retry ? result.recommendation_retry : null,
    acceptLearningPlan: typeof result?.accept_learning_plan === 'object' && result.accept_learning_plan ? result.accept_learning_plan : null,
    nextTask: result?.next_task?.next_task ?? resourceGeneration?.next_task ?? null,
    resourceGeneration: resourceGeneration || null,
    generatedResources,
    context: typeof result?.context === 'object' && result.context ? result.context : null,
    clarification: typeof result?.clarification === 'object' && result.clarification ? result.clarification : null,
    raw: response ?? null,
    errorMessage: response?.error_message ?? '',
    errorCode: response?.error_code ?? '',
  };
}

function parseInitPersonalSyllabusResponse(response) {
  return {
    success: Boolean(response?.success),
    syllabusId: response?.syllabus?.syllabus_id ?? null,
    personalSyllabusPath: response?.syllabus?.personal_syllabus_path ?? null,
    errorMessage: response?.error_message ?? '',
    errorCode: response?.error_code ?? '',
  };
}

function parseUpdatePersonalSyllabusResponse(response) {
  return {
    success: Boolean(response?.success),
    syllabus: response?.syllabus ?? null,
    errorMessage: response?.error_message ?? '',
    errorCode: response?.error_code ?? '',
  };
}

function parseLearningProfileResponse(response) {
  const rawProfile = response?.profile ?? response?.learning_profile ?? null;
  const knowledgeMastery = typeof rawProfile?.knowledge_mastery === 'object' && rawProfile?.knowledge_mastery
    ? rawProfile.knowledge_mastery
    : {};

  return {
    success: Boolean(response?.success),
    profile: rawProfile ? {
      ...rawProfile,
      knowledge_mastery: {
        overall_level: knowledgeMastery?.overall_level ?? 'none',
        overall_score: Number(knowledgeMastery?.overall_score ?? 0) || 0,
        syllabus_score: Number(knowledgeMastery?.syllabus_score ?? 0) || 0,
        answer_score: Number(knowledgeMastery?.answer_score ?? 0) || 0,
        engagement_score: Number(knowledgeMastery?.engagement_score ?? 0) || 0,
        by_knowledge_point: typeof knowledgeMastery?.by_knowledge_point === 'object' && knowledgeMastery?.by_knowledge_point
          ? knowledgeMastery.by_knowledge_point
          : {},
        knowledge_point_details: typeof knowledgeMastery?.knowledge_point_details === 'object' && knowledgeMastery?.knowledge_point_details
          ? knowledgeMastery.knowledge_point_details
          : {},
        weak_weeks: Array.isArray(knowledgeMastery?.weak_weeks) ? knowledgeMastery.weak_weeks : [],
        mastered_weeks: Array.isArray(knowledgeMastery?.mastered_weeks) ? knowledgeMastery.mastered_weeks : [],
      },
      concept_gaps: Array.isArray(rawProfile?.concept_gaps) ? rawProfile.concept_gaps : [],
      weak_points: Array.isArray(rawProfile?.weak_points) ? rawProfile.weak_points : [],
      mastered_points: Array.isArray(rawProfile?.mastered_points) ? rawProfile.mastered_points : [],
      resource_preference: Array.isArray(rawProfile?.resource_preference) ? rawProfile.resource_preference : [],
      recent_anomaly: Array.isArray(rawProfile?.recent_anomaly) ? rawProfile.recent_anomaly : [],
      evidence: Array.isArray(rawProfile?.evidence) ? rawProfile.evidence : [],
      source_events: Array.isArray(rawProfile?.source_events) ? rawProfile.source_events : [],
      signals: typeof rawProfile?.signals === 'object' && rawProfile?.signals ? rawProfile.signals : {},
      suggested_personal_syllabus_updates: Array.isArray(rawProfile?.suggested_personal_syllabus_updates)
        ? rawProfile.suggested_personal_syllabus_updates
        : [],
      confidence: Number(rawProfile?.confidence ?? 0) || 0,
      dropout_risk_score: Number(rawProfile?.dropout_risk_score ?? 0) || 0,
    } : null,
    errorMessage: response?.error_message ?? '',
    errorCode: response?.error_code ?? '',
  };
}

function ensureStudyGraphTree(tree, userId = null, syllabusId = null) {
  const rawTree = typeof tree === 'object' && tree ? tree : {};
  const treeId = rawTree.tree_id ?? (userId && syllabusId ? `study_tree:${userId}:${syllabusId}` : null);
  const subjectTitle = rawTree.subject_title ?? '';
  const rootTitle = rawTree?.virtual_root?.title ?? subjectTitle ?? '';

  return {
    schema_version: Number(rawTree.schema_version ?? 1) || 1,
    tree_id: treeId,
    user_id: rawTree.user_id ?? userId ?? null,
    syllabus_id: rawTree.syllabus_id ?? syllabusId ?? null,
    subject_title: subjectTitle,
    title: rawTree.title ?? (rootTitle ? `${rootTitle}学习成长树` : ''),
    virtual_root: {
      type: rawTree?.virtual_root?.type ?? 'tree_root',
      node_id: rawTree?.virtual_root?.node_id ?? (treeId ? `${treeId}:virtual_root` : 'study_tree_virtual_root'),
      title: rootTitle,
    },
    nodes: Array.isArray(rawTree.nodes) ? rawTree.nodes : [],
    edges: Array.isArray(rawTree.edges) ? rawTree.edges : [],
    summary: typeof rawTree.summary === 'object' && rawTree.summary ? rawTree.summary : {},
    created_at: rawTree.created_at ?? 0,
    updated_at: rawTree.updated_at ?? 0,
  };
}

function ensureStudyGraphFeatures(features, treeId = null) {
  const rawFeatures = typeof features === 'object' && features ? features : {};

  return {
    tree_id: rawFeatures.tree_id ?? treeId ?? null,
    learned_topics: Array.isArray(rawFeatures.learned_topics) ? rawFeatures.learned_topics : [],
    weak_topics: Array.isArray(rawFeatures.weak_topics) ? rawFeatures.weak_topics : [],
    mastered_topics: Array.isArray(rawFeatures.mastered_topics) ? rawFeatures.mastered_topics : [],
    recently_grown: Array.isArray(rawFeatures.recently_grown) ? rawFeatures.recently_grown : [],
    stale_topics: Array.isArray(rawFeatures.stale_topics) ? rawFeatures.stale_topics : [],
    tree_growth: Number(rawFeatures.tree_growth ?? 0) || 0,
    updated_at: Number(rawFeatures.updated_at ?? 0) || 0,
  };
}

function parseStudyGraphResponse(response, options = {}) {
  const rawGraph = typeof response?.graph === 'object' && response.graph ? response.graph : response;
  const userId = options.userId ?? rawGraph?.user_id ?? response?.user_id ?? null;
  const syllabusId = options.syllabusId ?? rawGraph?.syllabus_id ?? response?.syllabus_id ?? null;
  const tree = ensureStudyGraphTree(rawGraph?.tree, userId, syllabusId);
  const treeId = rawGraph?.tree_id ?? response?.tree_id ?? tree.tree_id ?? null;

  return {
    success: Boolean(response?.success ?? rawGraph?.success),
    userId,
    syllabusId,
    treeId,
    tree,
    features: ensureStudyGraphFeatures(rawGraph?.features ?? response?.features, treeId),
    changes: Array.isArray(rawGraph?.changes) ? rawGraph.changes : [],
    toolTrace: Array.isArray(rawGraph?.tool_trace) ? rawGraph.tool_trace : [],
    debug: rawGraph?.debug ?? response?.debug ?? null,
    errorMessage: response?.error_message ?? '',
    errorCode: response?.error_code ?? '',
  };
}

function formatWeekLabel(weekIndexList = []) {
  return weekIndexList.length ? `week ${weekIndexList.join(', ')}` : '';
}

function buildRecommendationItems(files, options = {}) {
  const matchedIds = Array.isArray(options.matchedIds) ? options.matchedIds : null;
  const weekIndexes = Array.isArray(options.weekIndexes) ? options.weekIndexes : null;

  return files
    .filter((file) => {
      if (matchedIds?.length) {
        return matchedIds.includes(file.fileId);
      }
      if (weekIndexes?.length) {
        return file.weekIndexList.some((weekIndex) => weekIndexes.includes(Number(weekIndex)));
      }
      return true;
    })
    .map((file) => ({
      fileId: file.fileId,
      title: file.title,
      source: file.source,
      weekLabel: formatWeekLabel(file.weekIndexList),
    }));
}

function normalizeRecommendationKey(value) {
  if (typeof value !== 'string') {
    return '';
  }

  return value
    .trim()
    .replace(/^[\s[({]+|[\s)\]}]+$/g, '')
    .replace(/\.[^.]+$/, '')
    .toLowerCase()
    .replace(/[\s_\-+./()[\]{}]+/g, '');
}

function buildRecommendationItemsByDocumentNames(files, documentNames = []) {
  const normalizedFiles = files.map((file) => ({
    ...file,
    normalizedTitle: normalizeRecommendationKey(file.title),
    normalizedPath: normalizeRecommendationKey(file.path),
  }));

  const items = [];
  const seen = new Set();

  documentNames.forEach((name) => {
    const normalizedName = normalizeRecommendationKey(name);
    if (!normalizedName) {
      return;
    }

    const matchedFile = normalizedFiles.find((file) => (
      normalizedName === file.normalizedTitle
      || normalizedName === file.normalizedPath
      || file.normalizedTitle.includes(normalizedName)
      || normalizedName.includes(file.normalizedTitle)
      || file.normalizedPath.includes(normalizedName)
    ));

    if (!matchedFile) {
      return;
    }

    const dedupeKey = matchedFile.fileId ?? matchedFile.title;
    if (seen.has(dedupeKey)) {
      return;
    }
    seen.add(dedupeKey);
    items.push({
      fileId: matchedFile.fileId,
      title: matchedFile.title,
      source: matchedFile.source,
      weekLabel: formatWeekLabel(matchedFile.weekIndexList),
    });
  });

  return items;
}

function mergeRecommendationItems(...groups) {
  const merged = [];
  const seen = new Set();

  groups.flat().forEach((item) => {
    if (!item) {
      return;
    }
    const dedupeKey = item.fileId ?? item.title;
    if (dedupeKey == null || seen.has(dedupeKey)) {
      return;
    }
    seen.add(dedupeKey);
    merged.push(item);
  });

  return merged;
}

function getRecommendationStorageKey(userId, syllabusId) {
  return `${RECOMMENDATION_STORAGE_PREFIX}:${userId}:${syllabusId}`;
}

function loadRecommendationMemory(userId, syllabusId) {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(getRecommendationStorageKey(userId, syllabusId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveRecommendationMemory(userId, syllabusId, items) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(getRecommendationStorageKey(userId, syllabusId), JSON.stringify(items));
}

function updateRecommendationMemory(userId, syllabusId, currentItems) {
  const previousItems = loadRecommendationMemory(userId, syllabusId);
  const nextItems = [];
  const currentMap = new Map();

  currentItems.forEach((item) => {
    const key = item.fileId ?? item.title;
    if (key == null) {
      return;
    }
    currentMap.set(key, item);
  });

  previousItems.forEach((stored) => {
    const key = stored.fileId ?? stored.title;
    if (key == null) {
      return;
    }

    if (currentMap.has(key)) {
      nextItems.push({
        ...currentMap.get(key),
        staleAskCount: 0,
      });
      currentMap.delete(key);
      return;
    }

    const staleAskCount = Number(stored.staleAskCount ?? 0) + 1;
    if (staleAskCount < RECOMMENDATION_EXPIRE_ASKS) {
      nextItems.push({
        ...stored,
        staleAskCount,
      });
    }
  });

  Array.from(currentMap.values()).reverse().forEach((item) => {
    nextItems.unshift({
      ...item,
      staleAskCount: 0,
    });
  });

  saveRecommendationMemory(userId, syllabusId, nextItems);
  return nextItems.map((item) => {
    const cleaned = { ...item };
    delete cleaned.staleAskCount;
    return cleaned;
  });
}

async function buildRecommendationItemsByFileIds(fileIds = [], syllabusFiles = []) {
  const dedupedIds = Array.from(new Set(
    (Array.isArray(fileIds) ? fileIds : [])
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value)),
  ));

  if (!dedupedIds.length) {
    return [];
  }

  const fileDetails = await Promise.all(dedupedIds.map(async (fileId) => {
    try {
      return await getFileDetail(fileId);
    } catch {
      return null;
    }
  }));

  return fileDetails
    .filter(Boolean)
    .map((file) => {
      const meta = syllabusFiles.find((item) => item.fileId === file.fileId);
      return {
        fileId: file.fileId,
        title: file.title,
        source: meta?.source ?? 'related-file',
        weekLabel: formatWeekLabel(meta?.weekIndexList ?? []),
      };
    });
}

function pickDefaultWeeks(personalSyllabus) {
  const period = Array.isArray(personalSyllabus?.period) ? personalSyllabus.period : [];
  const weakWeeks = period.filter((item) => item.competance === 'weak').map((item) => Number(item.week_index));

  if (weakWeeks.length) {
    return weakWeeks;
  }

  const noneWeeks = period.filter((item) => item.competance === 'none').map((item) => Number(item.week_index));
  return noneWeeks.length ? [noneWeeks[0]] : [];
}

function applyStudyHours(personalSyllabus, weekIndex, studyTimeSpent) {
  const next = cloneData(personalSyllabus);
  const target = (next?.period ?? []).find((item) => String(item.week_index) === String(weekIndex));

  if (!target) {
    return next;
  }

  const hours = Number(studyTimeSpent) || 0;
  let increment = 0;

  if (hours === 1) {
    increment = 2;
  } else if (hours === 2) {
    increment = 4;
  } else if (hours >= 3) {
    increment = 5;
  }

  let progress = Number(target.competance_progress ?? 0) + increment;
  let level = target.competance ?? 'normal';

  if (progress >= 5) {
    if (level === 'weak') {
      level = 'normal';
    } else if (level === 'normal') {
      level = 'master';
    }
    progress = 0;
  } else if (progress <= -5) {
    if (level === 'master') {
      level = 'normal';
    } else if (level === 'normal') {
      level = 'weak';
    }
    progress = 0;
  }

  target.competance = level;
  target.competance_progress = progress;
  target.updated_at = 1775700000;
  next.reviewed_at = 1775700000;

  return next;
}

export async function listStudentSyllabusesRaw(payload = {}) {
  const userId = requireUserId({ ...payload, allowMockFallback: USE_MOCK_STUDENT_SYLLABUS_LIST });
  if (!USE_MOCK_STUDENT_SYLLABUS_LIST) {
    return apiPost('/api/syllabus_list', {
      user_id: userId,
      manage: false,
    });
  }

  return createExternalMockStudentSyllabusListResponse()
    ?? cloneData(RAW_LIST_ALL_SYLLABUSES_BRIEF_INFO_FOR_LEARNING_RESPONSE_FOR_USER_7);
}

export async function getPersonalSyllabusRaw(syllabusId, userId = null) {
  const resolvedUserId = requireUserId({ userId, allowMockFallback: USE_MOCK_API });
  if (!USE_MOCK_API) {
    return apiPost('/api/learning_personal_syllabus_detail', {
      user_id: resolvedUserId,
      syllabus_id: syllabusId,
    });
  }

  return createExternalMockPersonalSyllabusResponse(syllabusId)
    ?? cloneData(
      RAW_GET_PERSONAL_SYLLABUS_DETAIL_INFO_RESPONSE_BY_SYLLABUS_ID_FOR_USER_7[syllabusId]
      ?? {
        success: true,
        syllabus: null,
        error_message: '',
        error_code: '',
      },
    );
}

export async function askQuestionRaw(payload = {}) {
  const userId = requireUserId({ ...payload, allowMockFallback: USE_MOCK_API });
  if (!USE_MOCK_API) {
    return apiPost('/api/total_agent/run', {
      user_id: userId,
      syllabus_id: payload.syllabusId ?? payload.syllabus_id,
      message: payload.message ?? payload.question ?? '',
      question: payload.question ?? payload.message ?? '',
      intent: payload.intent ?? '',
      auto_accept: payload.autoAccept ?? payload.auto_accept ?? false,
      candidate_index: payload.candidateIndex ?? payload.candidate_index ?? null,
      recommendation_result: payload.recommendationResult ?? payload.recommendation_result ?? null,
      resource_types: payload.resourceTypes ?? payload.resource_types ?? [],
      tone_style: payload.toneStyle ?? payload.tone_style ?? '',
      answer_style: payload.answerStyle ?? payload.answer_style ?? '',
      question_type_hint: payload.questionTypeHint ?? payload.question_type_hint ?? '',
      profile_read_action: payload.profileReadAction ?? payload.profile_read_action ?? '',
      conversation_history: payload.conversationHistory ?? payload.conversation_history ?? payload.messages ?? [],
      context: payload.context ?? {},
    });
  }

  const text = String(payload.message ?? payload.question ?? '').trim();
  const normalized = text.toLowerCase();
  if (!text) {
    return {
      success: true,
      schema_version: 'total_agent.v1',
      intent: 'ask_goal_clarification',
      tool_trace: ['load_total_context', 'infer_user_intent'],
      tool_status_events: [],
      result: {
        clarification: {
          reason: 'need clearer learning goal',
        },
      },
      suggested_next_action: 'ask_goal_clarification',
      error_message: '',
      error_code: '',
    };
  }

  if (
    payload.intent === 'accept_recommendation'
    || payload.autoAccept
    || normalized.includes('确认')
    || normalized.includes('采纳')
    || normalized.includes('accept')
  ) {
    return {
      success: true,
      schema_version: 'total_agent.v1',
      intent: 'accept_recommendation',
      tool_trace: ['load_total_context', 'infer_user_intent', 'accept_learning_plan', 'get_next_learning_task'],
      tool_status_events: [],
      result: {
        accept_learning_plan: {
          success: true,
          accepted: true,
          plan: { plan_id: 'mock-plan-1' },
          next_task: {
            step_id: 'step-1',
            node_id: 'hbase_intro',
            title: 'HBase 基础',
            status: 'active',
          },
        },
        next_task: {
          success: true,
          next_task: {
            step_id: 'step-1',
            node_id: 'hbase_intro',
            title: 'HBase 基础',
            status: 'active',
          },
        },
      },
      suggested_next_action: 'generate_current_step_resource',
      error_message: '',
      error_code: '',
    };
  }

  if (
    payload.intent === 'generate_current_step_resource'
    || normalized.includes('继续')
    || normalized.includes('资料')
    || normalized.includes('resource')
  ) {
    return {
      success: true,
      schema_version: 'total_agent.v1',
      intent: 'generate_current_step_resource',
      tool_trace: ['load_total_context', 'infer_user_intent', 'get_next_learning_task', 'generate_current_step_resource'],
      tool_status_events: [],
      result: {
        next_task: {
          success: true,
          next_task: {
            step_id: 'step-1',
            node_id: 'hbase_intro',
            title: 'HBase 基础',
            status: 'active',
          },
        },
        resource_generation: {
          success: true,
          next_task: {
            step_id: 'step-1',
            node_id: 'hbase_intro',
            title: 'HBase 基础',
            status: 'active',
          },
          resources: [
            {
              resource_id: 'documents-mock-1',
              resource_type: 'documents',
              title: 'HBase 基础讲解文档',
              topic: 'HBase 基础',
              status: 'ready',
            },
          ],
        },
      },
      suggested_next_action: 'record_learning_feedback',
      error_message: '',
      error_code: '',
    };
  }

  if (normalized.includes('推荐') || normalized.includes('路径') || normalized.includes('怎么学')) {
    return {
      success: true,
      schema_version: 'total_agent.v1',
      intent: 'recommend_learning_path',
      tool_trace: ['load_total_context', 'infer_user_intent', 'run_learning_recommendation'],
      tool_status_events: [],
      result: {
        recommendation: {
          success: true,
          recommendation: {
            success: true,
            graph: {
              nodes: [
                { id: 'hbase_intro', title: 'HBase 基础' },
                { id: 'rowkey_design', title: 'RowKey 设计' },
              ],
              edges: [
                { source: 'hbase_intro', target: 'rowkey_design' },
              ],
            },
            candidates: [
              {
                path: ['hbase_intro', 'rowkey_design'],
                selected: true,
              },
            ],
            selected: [
              {
                path: ['hbase_intro', 'rowkey_design'],
                selected: true,
              },
            ],
            best_path: {
              path: ['hbase_intro', 'rowkey_design'],
              selected: true,
            },
          },
        },
      },
      suggested_next_action: 'wait_user_acceptance',
      error_message: '',
      error_code: '',
    };
  }

  return {
    success: true,
    schema_version: 'total_agent.v1',
    intent: 'answer_learning_question',
    tool_trace: ['load_total_context', 'infer_user_intent', 'retrieve_learning_evidence', 'answer_learning_question'],
    tool_status_events: [],
    result: {
      answer_learning_question: {
        success: true,
        answer: {
          question_type: 'concept_explanation',
          text: cloneData(RAW_ASK_QUESTION_RESPONSE_FOR_USER_7_SYLLABUS_1.answer ?? '这里会返回总 Agent 的回答。'),
          key_points: ['围绕当前问题给出解释', '结合当前课程上下文继续学习'],
          evidence_used: [
            { title: '课程资料', source: 'RAG', relevance: 'medium' },
          ],
          plan_reference: {},
          next_actions: [
            {
              action: 'offer_resource',
              label_key: 'agent.answer.next_action.offer_resource',
              resource_type: 'documents',
            },
          ],
          confidence: 0.82,
          tone: {
            tone_style: payload.toneStyle ?? payload.tone_style ?? 'friendly_pragmatic',
            answer_style: payload.answerStyle ?? payload.answer_style ?? 'normal',
          },
          warnings: [],
        },
      },
    },
    suggested_next_action: 'offer_practice_or_resource',
    error_message: '',
    error_code: '',
  };
}

export async function getLearningProfileRaw(payload = {}) {
  const userId = requireUserId({ ...payload, allowMockFallback: USE_MOCK_API });
  if (!USE_MOCK_API) {
    return apiPost('/api/user_learning_profile', {
      user_id: userId,
      syllabus_id: payload.syllabusId ?? payload.syllabus_id ?? null,
      dialogue_text: payload.dialogueText ?? payload.dialogue_text ?? null,
      learning_goal: payload.learningGoal ?? payload.learning_goal ?? null,
      learning_records: payload.learningRecords ?? payload.learning_records ?? null,
      answer_records: payload.answerRecords ?? payload.answer_records ?? null,
      resource_usage: payload.resourceUsage ?? payload.resource_usage ?? null,
    });
  }

  return createExternalMockLearningProfileResponse(payload.syllabusId ?? payload.syllabus_id ?? null);
}

export async function getStudyGraphDetailRaw(payload = {}) {
  const userId = requireUserId({ ...payload, allowMockFallback: USE_MOCK_API });
  const syllabusId = payload.syllabusId ?? payload.syllabus_id ?? null;

  if (!USE_MOCK_API) {
    return apiGet('/api/study_graph/detail', {
      user_id: userId,
      syllabus_id: syllabusId,
      include_debug: payload.includeDebug ?? payload.include_debug ?? false,
    });
  }

  return {
    success: true,
    user_id: userId,
    syllabus_id: syllabusId,
    tree_id: `study_tree:${userId}:${syllabusId ?? 1}`,
    tree: {
      schema_version: 1,
      tree_id: `study_tree:${userId}:${syllabusId ?? 1}`,
      user_id: userId,
      syllabus_id: syllabusId,
      subject_title: '大数据概论',
      title: '大数据概论学习成长树',
      virtual_root: {
        type: 'tree_root',
        node_id: `study_tree_root:${userId}:${syllabusId ?? 1}`,
        title: '大数据概论',
      },
      nodes: [
        {
          node_id: `knowledge:${userId}:${syllabusId ?? 1}:machine-learning`,
          title: '机器学习',
          summary: '课程中逐步建立的核心主题。',
          mastery: { label: 'normal', score: 0.68 },
          display: { stage: 'branch' },
          last_updated_at: 1760000000,
        },
        {
          node_id: `knowledge:${userId}:${syllabusId ?? 1}:supervised-learning`,
          title: '监督学习',
          summary: '已经触达，但还需要通过练习继续巩固。',
          mastery: { label: 'learning', score: 0.54 },
          display: { stage: 'growing' },
          last_updated_at: 1760000000,
        },
        {
          node_id: `knowledge:${userId}:${syllabusId ?? 1}:rowkey-hotspot`,
          title: 'RowKey 热点',
          summary: '当前画像和作答表现显示这里相对薄弱。',
          mastery: { label: 'weak', score: 0.28 },
          display: { stage: 'seed' },
          last_updated_at: 1760000000,
        },
        {
          node_id: `knowledge:${userId}:${syllabusId ?? 1}:pre-split`,
          title: '预分区策略',
          summary: '和热点规避关联较强，最近有明显增长。',
          mastery: { label: 'mastered', score: 0.86 },
          display: { stage: 'fruit' },
          last_updated_at: 1760000000,
        },
      ],
      edges: [
        {
          edge_id: `study_tree:${userId}:${syllabusId ?? 1}:parent_of:machine-learning:supervised-learning`,
          source: `knowledge:${userId}:${syllabusId ?? 1}:machine-learning`,
          target: `knowledge:${userId}:${syllabusId ?? 1}:supervised-learning`,
          edge_type: 'parent_of',
        },
        {
          edge_id: `study_tree:${userId}:${syllabusId ?? 1}:parent_of:supervised-learning:rowkey-hotspot`,
          source: `knowledge:${userId}:${syllabusId ?? 1}:supervised-learning`,
          target: `knowledge:${userId}:${syllabusId ?? 1}:rowkey-hotspot`,
          edge_type: 'parent_of',
        },
        {
          edge_id: `study_tree:${userId}:${syllabusId ?? 1}:parent_of:rowkey-hotspot:pre-split`,
          source: `knowledge:${userId}:${syllabusId ?? 1}:rowkey-hotspot`,
          target: `knowledge:${userId}:${syllabusId ?? 1}:pre-split`,
          edge_type: 'parent_of',
        },
      ],
      summary: {
        learned_node_count: 4,
        mastered_node_count: 1,
        weak_node_count: 1,
        tree_growth: 0.59,
      },
    },
    debug: {},
    error_message: '',
    error_code: '',
  };
}

export async function getStudyGraphFeaturesRaw(payload = {}) {
  const userId = requireUserId({ ...payload, allowMockFallback: USE_MOCK_API });
  const syllabusId = payload.syllabusId ?? payload.syllabus_id ?? null;

  if (!USE_MOCK_API) {
    return apiGet('/api/study_graph/features', {
      user_id: userId,
      syllabus_id: syllabusId,
    });
  }

  return {
    success: true,
    user_id: userId,
    syllabus_id: syllabusId,
    tree_id: `study_tree:${userId}:${syllabusId ?? 1}`,
    features: {
      tree_id: `study_tree:${userId}:${syllabusId ?? 1}`,
      learned_topics: ['机器学习', '监督学习', 'RowKey 热点', '预分区策略'],
      weak_topics: ['RowKey 热点'],
      mastered_topics: ['预分区策略'],
      recently_grown: ['预分区策略', '监督学习'],
      stale_topics: [],
      tree_growth: 0.59,
      updated_at: 1760000000,
    },
    error_message: '',
    error_code: '',
  };
}

export async function runStudyGraphAgentRaw(payload = {}) {
  const userId = requireUserId({ ...payload, allowMockFallback: USE_MOCK_API });
  const syllabusId = payload.syllabusId ?? payload.syllabus_id ?? null;

  if (!USE_MOCK_API) {
    return apiPost('/api/study_graph/agent_run', {
      dispatch_id: payload.dispatchId ?? payload.dispatch_id ?? '',
      source_kind: payload.sourceKind ?? payload.source_kind ?? 'total_agent',
      user_id: userId,
      syllabus_id: syllabusId,
      subject_title: payload.subjectTitle ?? payload.subject_title ?? '',
      question: payload.question ?? '',
      learning_goal: payload.learningGoal ?? payload.learning_goal ?? '',
      personal_syllabus_context: payload.personalSyllabusContext ?? payload.personal_syllabus_context ?? {},
      rag_context: payload.ragContext ?? payload.rag_context ?? [],
      detected_topics: payload.detectedTopics ?? payload.detected_topics ?? [],
      events: payload.events ?? [],
      parent_candidates: payload.parentCandidates ?? payload.parent_candidates ?? [],
      source: payload.source ?? { kind: payload.sourceKind ?? payload.source_kind ?? 'total_agent' },
      timestamp: payload.timestamp ?? null,
    });
  }

  const detail = await getStudyGraphDetailRaw({ userId, syllabusId });
  const features = await getStudyGraphFeaturesRaw({ userId, syllabusId });

  return {
    success: true,
    user_id: userId,
    syllabus_id: syllabusId,
    tree_id: detail?.tree_id ?? `study_tree:${userId}:${syllabusId ?? 1}`,
    tree: detail?.tree ?? null,
    features: features?.features ?? null,
    changes: [
      {
        client_change_id: `mock-change:${userId}:${syllabusId ?? 1}:1`,
        title: 'RowKey 热点',
        status: 'accepted',
        confidence: 0.78,
      },
    ],
    tool_trace: [
      'rag_search',
      'get_student_learning_tree_context',
      'derive_payload',
      'build_study_graph_changes',
      'submit_learning_tree_changes',
      'get_student_learning_tree',
      'get_learning_tree_features',
    ],
    error_message: '',
    error_code: '',
  };
}

export async function getStudyGraphRaw(payload = {}) {
  const userId = requireUserId({ ...payload, allowMockFallback: USE_MOCK_API });
  const syllabusId = payload.syllabusId ?? payload.syllabus_id ?? null;

  if (USE_MOCK_API) {
    return createExternalMockStudyGraphResponse(syllabusId);
  }

  const detail = await getStudyGraphDetailRaw({ userId, syllabusId, includeDebug: payload.includeDebug ?? payload.include_debug ?? false });
  const features = await getStudyGraphFeaturesRaw({ userId, syllabusId });
  const detailGraph = typeof detail?.graph === 'object' && detail.graph ? detail.graph : detail;

  const detailLooksUnavailable = !detail?.success && (detail?.error_code === 'invalid_json_response');
  const featureLooksUnavailable = !features?.success && (features?.error_code === 'invalid_json_response');

  if (detailLooksUnavailable && featureLooksUnavailable) {
    return apiPost('/api/learning_study_graph', {
      user_id: userId,
      syllabus_id: syllabusId,
      include_debug: payload.includeDebug ?? payload.include_debug ?? false,
    });
  }

  return {
    success: Boolean(detail?.success) && Boolean(features?.success),
    user_id: userId,
    syllabus_id: syllabusId,
    tree_id: detailGraph?.tree_id ?? features?.tree_id ?? null,
    tree: detailGraph?.tree ?? null,
    features: features?.features ?? null,
    debug: detailGraph?.debug ?? {},
    error_message: detail?.error_message || features?.error_message || '',
    error_code: detail?.error_code || features?.error_code || '',
  };
}

export async function initPersonalSyllabusRaw(payload = {}) {
  const userId = requireUserId({ ...payload, allowMockFallback: USE_MOCK_API });
  if (!USE_MOCK_API) {
    return apiPost('/api/learning_init_personal_syllabus', {
      user_id: userId,
      syllabus_id: payload.syllabusId ?? payload.syllabus_id,
    });
  }

  return cloneData(externalInitPersonalSyllabusResponse)
    ?? {
      success: true,
      syllabus: {
        syllabus_id: payload.syllabusId ?? null,
        user_id: userId,
        personal_syllabus_path: `./schedule/student_alt/user_${userId}/${payload.syllabusId ?? 0}_personal.json`,
      },
      error_message: '',
      error_code: '',
    };
}

export async function updatePersonalSyllabusRaw(payload = {}) {
  const userId = requireUserId({ ...payload, allowMockFallback: USE_MOCK_API });
  if (!USE_MOCK_API) {
    return apiPost('/api/learning_update_personal_syllabus', {
      user_id: userId,
      syllabus_id: payload.syllabusId ?? payload.syllabus_id,
      week_index: payload.weekIndex ?? payload.week_index,
      study_time_spent: payload.studyTimeSpent ?? payload.study_time_spent,
    });
  }

  const source = cloneData(
    createExternalMockPersonalSyllabusResponse(payload.syllabusId)?.syllabus
      ?? RAW_GET_PERSONAL_SYLLABUS_DETAIL_INFO_RESPONSE_BY_SYLLABUS_ID_FOR_USER_7[payload.syllabusId]?.syllabus
      ?? RAW_GET_PERSONAL_SYLLABUS_DETAIL_INFO_RESPONSE_BY_SYLLABUS_ID_FOR_USER_7[1]?.syllabus
      ?? null,
  );
  const updated = source ? applyStudyHours(source, payload.weekIndex, payload.studyTimeSpent) : null;

  return {
    success: Boolean(updated),
    syllabus: updated,
    request: payload,
    error_message: updated ? '' : 'not_found',
    error_code: updated ? '' : 'not_found',
  };
}

export async function getStudentDashboardData() {
  const list = parseStudentSyllabusListResponse(await listStudentSyllabusesRaw());

  const syllabuses = await Promise.all(
    list.map(async (item) => {
      const personal = item.personalSyllabusPath ? parsePersonalSyllabusResponse(await getPersonalSyllabusRaw(item.syllabusId)) : null;
      const syllabusFiles = await listSyllabusFiles([item.syllabusId]);
      const defaultWeeks = pickDefaultWeeks(personal);

      return {
        syllabusId: item.syllabusId,
        title: item.title,
        isLearning: item.isLearning,
        dayOneTime: item.dayOneTime,
        personalSyllabus: personal,
        syllabusFiles,
        defaultRecommendations: buildRecommendationItems(syllabusFiles, { weekIndexes: defaultWeeks }),
      };
    }),
  );

  return { syllabuses };
}

export async function initPersonalSyllabus(payload = {}) {
  return parseInitPersonalSyllabusResponse(await initPersonalSyllabusRaw(payload));
}

export async function getPersonalSyllabus(payload = {}) {
  return parsePersonalSyllabusResponse(await getPersonalSyllabusRaw(
    payload.syllabusId ?? payload.syllabus_id,
    payload.userId ?? payload.user_id ?? null,
  ));
}

export async function updatePersonalSyllabus(payload = {}) {
  return parseUpdatePersonalSyllabusResponse(await updatePersonalSyllabusRaw(payload));
}

export async function getLearningProfile(payload = {}) {
  return parseLearningProfileResponse(await getLearningProfileRaw(payload));
}

export async function getStudyGraph(payload = {}) {
  return parseStudyGraphResponse(await getStudyGraphRaw(payload), {
    userId: payload.userId ?? payload.user_id ?? getCurrentUserId(),
    syllabusId: payload.syllabusId ?? payload.syllabus_id ?? null,
  });
}

export async function runStudyGraphAgent(payload = {}) {
  return parseStudyGraphResponse(await runStudyGraphAgentRaw(payload), {
    userId: payload.userId ?? payload.user_id ?? getCurrentUserId(),
    syllabusId: payload.syllabusId ?? payload.syllabus_id ?? null,
  });
}

export async function askQuestion(payload = {}) {
  const parsed = parseAskQuestionResponse(await askQuestionRaw(payload));
  const rawDocumentNames = Array.isArray(parsed.raw?.document_names) ? parsed.raw.document_names : [];
  const shouldLoadSyllabusFiles = Boolean(payload.syllabusId) && (parsed.matchedFiles.length > 0 || rawDocumentNames.length > 0);
  const syllabusFiles = shouldLoadSyllabusFiles ? await listSyllabusFiles([payload.syllabusId]) : [];

  const fileIdRecommendationItems = await buildRecommendationItemsByFileIds(parsed.matchedFiles, syllabusFiles);
  const documentNameRecommendationItems = buildRecommendationItemsByDocumentNames(syllabusFiles, rawDocumentNames);
  const mergedRecommendationItems = mergeRecommendationItems(fileIdRecommendationItems, documentNameRecommendationItems);

  const userId = getCurrentUserId();
  const rememberedRecommendationItems = payload.syllabusId && userId
    ? updateRecommendationMemory(userId, payload.syllabusId, mergedRecommendationItems)
    : mergedRecommendationItems;

  return {
    ...parsed,
    recommendedMaterials: rememberedRecommendationItems,
  };
}

export {
  parseAskQuestionResponse,
  parseLearningProfileResponse,
  parseStudyGraphResponse,
  parseInitPersonalSyllabusResponse,
  parsePersonalSyllabusResponse,
  parseStudentSyllabusListResponse,
  parseUpdatePersonalSyllabusResponse,
};
