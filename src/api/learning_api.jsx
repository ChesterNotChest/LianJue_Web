import {
  RAW_ASK_QUESTION_RESPONSE_FOR_USER_7_SYLLABUS_1,
  RAW_GET_PERSONAL_SYLLABUS_DETAIL_INFO_RESPONSE_BY_SYLLABUS_ID_FOR_USER_7,
  RAW_LIST_ALL_SYLLABUSES_BRIEF_INFO_FOR_LEARNING_RESPONSE_FOR_USER_7,
} from './mock_payloads';
import { USE_MOCK_API, apiGet, apiPost } from './client';
import { getFileDetail, listSyllabusFiles } from './file_transmit_api';
import { getCurrentUserId, requireUserId } from './session';

const RECOMMENDATION_STORAGE_PREFIX = 'student_recommendations_v1';
const RECOMMENDATION_EXPIRE_ASKS = 5;

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
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

function parseAskQuestionResponse(response) {
  return {
    success: Boolean(response?.success),
    answer: response?.answer ?? '',
    matchedFiles: Array.isArray(response?.matched_files) ? response.matched_files : [],
    competanceList: Array.isArray(response?.competance_list) ? response.competance_list : [],
    raw: response?.raw ?? null,
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
  const userId = options.userId ?? response?.user_id ?? null;
  const syllabusId = options.syllabusId ?? response?.syllabus_id ?? null;
  const tree = ensureStudyGraphTree(response?.tree, userId, syllabusId);
  const treeId = response?.tree_id ?? tree.tree_id ?? null;

  return {
    success: Boolean(response?.success),
    userId,
    syllabusId,
    treeId,
    tree,
    features: ensureStudyGraphFeatures(response?.features, treeId),
    changes: Array.isArray(response?.changes) ? response.changes : [],
    toolTrace: Array.isArray(response?.tool_trace) ? response.tool_trace : [],
    debug: response?.debug ?? null,
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
  const userId = requireUserId({ ...payload, allowMockFallback: USE_MOCK_API });
  if (!USE_MOCK_API) {
    return apiPost('/api/syllabus_list', {
      user_id: userId,
      manage: false,
    });
  }

  return cloneData(RAW_LIST_ALL_SYLLABUSES_BRIEF_INFO_FOR_LEARNING_RESPONSE_FOR_USER_7);
}

export async function getPersonalSyllabusRaw(syllabusId, userId = null) {
  const resolvedUserId = requireUserId({ userId, allowMockFallback: USE_MOCK_API });
  if (!USE_MOCK_API) {
    return apiPost('/api/learning_personal_syllabus_detail', {
      user_id: resolvedUserId,
      syllabus_id: syllabusId,
    });
  }

  return cloneData(RAW_GET_PERSONAL_SYLLABUS_DETAIL_INFO_RESPONSE_BY_SYLLABUS_ID_FOR_USER_7[syllabusId]);
}

export async function askQuestionRaw(payload = {}) {
  const userId = requireUserId({ ...payload, allowMockFallback: USE_MOCK_API });
  if (!USE_MOCK_API) {
    return apiPost('/api/learning_ask_question', {
      user_id: userId,
      syllabus_id: payload.syllabusId ?? payload.syllabus_id,
      question: payload.question ?? '',
    });
  }

  return {
    success: true,
    ...cloneData(RAW_ASK_QUESTION_RESPONSE_FOR_USER_7_SYLLABUS_1),
    request: {
      user_id: userId,
      syllabus_id: payload.syllabusId ?? null,
      question: payload.question ?? '',
    },
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

  return {
    success: true,
    profile: {
      user_id: userId,
      syllabus_id: payload.syllabusId ?? payload.syllabus_id ?? null,
      syllabus_scope: [],
      learning_goal: payload.learningGoal ?? '掌握当前课程核心知识点',
      knowledge_mastery: {
        overall_level: 'normal',
        overall_score: 0.67,
        syllabus_score: 0.62,
        answer_score: 0.64,
        engagement_score: 0.74,
        by_knowledge_point: {},
        knowledge_point_details: {
          机器学习: { score: 0.46, attempt_count: 3, level: 'weak' },
          监督学习: { score: 0.58, attempt_count: 2, level: 'normal' },
          特征工程: { score: 0.52, attempt_count: 2, level: 'normal' },
          模型评估: { score: 0.41, attempt_count: 1, level: 'weak' },
        },
        weak_weeks: [4, 5],
        mastered_weeks: [1, 2, 3, 6],
      },
      concept_gaps: ['机器学习', '模型评估'],
      weak_points: ['机器学习', '模型评估'],
      mastered_points: ['数据清洗', 'Python 基础'],
      resource_preference: ['documents', 'mindmap'],
      learning_style: 'visual-driven',
      dropout_risk: 'medium',
      dropout_risk_score: 0.38,
      recent_anomaly: [],
      confidence: 0.72,
      evidence: [],
      source_events: [],
      signals: {},
      suggested_personal_syllabus_updates: [],
    },
    error_message: '',
    error_code: '',
  };
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
    const [detail, features] = await Promise.all([
      getStudyGraphDetailRaw({ userId, syllabusId, includeDebug: payload.includeDebug ?? payload.include_debug ?? false }),
      getStudyGraphFeaturesRaw({ userId, syllabusId }),
    ]);

    return {
      success: Boolean(detail?.success) && Boolean(features?.success),
      user_id: userId,
      syllabus_id: syllabusId,
      tree_id: detail?.tree_id ?? features?.tree_id ?? null,
      tree: detail?.tree ?? null,
      features: features?.features ?? null,
      debug: detail?.debug ?? {},
      error_message: detail?.error_message || features?.error_message || '',
      error_code: detail?.error_code || features?.error_code || '',
    };
  }

  const detail = await getStudyGraphDetailRaw({ userId, syllabusId, includeDebug: payload.includeDebug ?? payload.include_debug ?? false });
  const features = await getStudyGraphFeaturesRaw({ userId, syllabusId });

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
    tree_id: detail?.tree_id ?? features?.tree_id ?? null,
    tree: detail?.tree ?? null,
    features: features?.features ?? null,
    debug: detail?.debug ?? {},
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

  return {
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
    RAW_GET_PERSONAL_SYLLABUS_DETAIL_INFO_RESPONSE_BY_SYLLABUS_ID_FOR_USER_7[payload.syllabusId]?.syllabus
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
  const syllabusFiles = payload.syllabusId ? await listSyllabusFiles([payload.syllabusId]) : [];
  const rawDocumentNames = Array.isArray(parsed.raw?.document_names) ? parsed.raw.document_names : [];

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
