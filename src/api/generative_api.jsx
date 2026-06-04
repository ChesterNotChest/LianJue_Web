import { USE_MOCK_API, apiPost } from './client';
import { getCurrentUserId, requireUserId } from './session';

function normalizeResourceType(value) {
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

function normalizeResourceTypeList(value) {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  const deduped = [];

  list.forEach((item) => {
    const normalized = normalizeResourceType(item);
    if (normalized && !deduped.includes(normalized)) {
      deduped.push(normalized);
    }
  });

  return deduped;
}

function parseResourceSummary(item = {}) {
  return {
    resourceId: item.resource_id ?? '',
    resourceType: normalizeResourceType(item.resource_type ?? ''),
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

function parseGenerateResponse(response) {
  const resources = Array.isArray(response?.resources) ? response.resources.map(parseResourceSummary) : [];
  return {
    success: Boolean(response?.success),
    request: typeof response?.request === 'object' && response.request ? response.request : null,
    resources,
    resourceCount: Number(response?.resource_count ?? resources.length ?? 0),
    successCount: Number(response?.success_count ?? resources.filter((item) => item.success).length ?? 0),
    failedCount: Number(response?.failed_count ?? Math.max(0, resources.length - resources.filter((item) => item.success).length)),
    toolTrace: Array.isArray(response?.tool_trace) ? response.tool_trace : [],
    errorMessage: response?.error_message ?? '',
    errorCode: response?.error_code ?? '',
  };
}

function parseListResponse(response) {
  return {
    success: Boolean(response?.success),
    materials: Array.isArray(response?.materials) ? response.materials.map(parseResourceSummary) : [],
    errorMessage: response?.error_message ?? '',
    errorCode: response?.error_code ?? '',
  };
}

function parseDetailResponse(response) {
  const material = response?.material ?? null;
  return {
    success: Boolean(response?.success),
    material: material ? {
      ...parseResourceSummary(material),
      content: typeof material.content === 'object' && material.content ? material.content : null,
      render: typeof material.render === 'object' && material.render ? material.render : {},
    } : null,
    errorMessage: response?.error_message ?? '',
    errorCode: response?.error_code ?? '',
  };
}

function renderMockMarkdown(type, topic, question) {
  if (type === 'documents') {
    return `# ${topic} 讲解文档\n\n围绕问题：${question}\n\n## 核心概念\n- 梳理主题定义\n- 对齐课程上下文\n\n## 常见误区\n- 避免只记结论，不理解原因`;
  }
  if (type === 'quiz') {
    return `# ${topic} 练习题\n\n1. ${topic} 的关键目标是什么？\n\n答案：理解核心概念并能解释应用场景。`;
  }
  if (type === 'ppt') {
    return `# ${topic} 复习课件\n\n## Slide 1\n- 学习目标\n\n## Slide 2\n- 关键知识点`;
  }
  if (type === 'coding_practice') {
    return `# ${topic} 实操案例\n\n## 目标\n- 构建最小可运行示例\n\n## 步骤\n- 编写代码\n- 运行并验证`;
  }
  return '';
}

function buildMockResourceContent(type, payload = {}) {
  const topic = payload.topic || payload.question || '当前主题';
  const question = payload.question || `请围绕 ${topic} 生成资源`;

  if (type === 'mindmap') {
    return {
      title: `${topic} 思维导图`,
      root: topic,
      nodes: [
        {
          label: topic,
          children: [
            { label: '核心概念' },
            { label: '关键机制' },
            { label: '易错点' },
          ],
        },
      ],
      mermaid: `mindmap\n  root((${topic}))\n    核心概念\n    关键机制\n    易错点`,
    };
  }

  if (type === 'quiz') {
    return {
      schema_version: 'v1',
      title: `${topic} 练习题`,
      topic,
      questions: [
        {
          id: 'q1',
          type: 'single_choice',
          difficulty: 'medium',
          stem: `${topic} 最需要优先掌握的是什么？`,
          options: ['定义', '机制', '应用', '误区'],
          answer: 'B',
          explanation: '资源生成会优先突出机制理解和应用判断。',
          knowledge_points: [topic],
        },
      ],
    };
  }

  if (type === 'ppt') {
    return {
      schema_version: 'v1',
      title: `${topic} 复习课件`,
      topic,
      summary: `围绕“${question}”生成的结构化课件。`,
      theme: 'academic-rich',
      slide_style: 'study-review',
      slides: [
        {
          slide_index: 1,
          title: '学习目标',
          body: `本节聚焦 ${topic} 的核心理解与复习目标。`,
          bullets: ['明确主题范围', '定位关键机制', '识别易错点'],
        },
        {
          slide_index: 2,
          title: '关键知识点',
          body: '围绕定义、机制和场景三条线快速建立结构。',
          bullets: ['概念边界', '内部过程', '典型应用'],
        },
      ],
    };
  }

  if (type === 'coding_practice') {
    return {
      schema_version: 'v1',
      title: `${topic} 实操案例`,
      topic,
      summary: `围绕 ${topic} 的最小可运行实践。`,
      learning_objectives: [`理解 ${topic}`, `完成 ${topic} 的最小实践`],
      steps: ['准备运行环境', '阅读示例代码', '运行并观察输出'],
      code_files: [
        {
          path: 'main.py',
          content: `def explain():\n    return "${topic} practice"\n\nprint(explain())\n`,
        },
      ],
      run_guide: {
        command: 'python main.py',
        expected_output: `${topic} practice`,
      },
    };
  }

  return {
    schema_version: 'v1',
    title: `${topic} 讲解文档`,
    topic,
    summary: `围绕“${question}”整理出的讲解文档。`,
    sections: [
      {
        heading: '核心概念',
        body: `${topic} 的核心目标是帮助学生建立结构化理解。`,
        key_points: ['先理解定义', '再看机制', '最后连接应用'],
      },
      {
        heading: '复习提示',
        body: '复习时优先关注当前问题对应的薄弱点。',
        pitfalls: ['只记结论不记原因'],
        checklist: ['能解释概念', '能举出例子'],
      },
    ],
    extension_reading: [
      { title: `${topic} 进阶阅读`, reason: '继续扩展相关应用场景' },
    ],
  };
}

let mockGeneratedStore = {};

function saveMockMaterial(userId, material) {
  const current = Array.isArray(mockGeneratedStore[userId]) ? mockGeneratedStore[userId] : [];
  mockGeneratedStore[userId] = [material, ...current];
}

export async function generateResourcesRaw(payload = {}) {
  const userId = requireUserId({ ...payload, allowMockFallback: USE_MOCK_API });
  const resourceTypes = normalizeResourceTypeList(payload.resourceTypes ?? payload.resource_types);

  if (!USE_MOCK_API) {
    return apiPost('/api/generative_generate', {
      user_id: userId,
      question: payload.question ?? payload.studentQuestion ?? payload.student_question ?? '',
      resource_types: resourceTypes,
      syllabus_id: payload.syllabusId ?? payload.syllabus_id ?? null,
      topic: payload.topic ?? '',
      selected_weeks: payload.selectedWeeks ?? payload.selected_weeks ?? [],
      knowledge_items: payload.knowledgeItems ?? payload.knowledge_items ?? [],
      weak_points: payload.weakPoints ?? payload.weak_points ?? [],
      learning_goal: payload.learningGoal ?? payload.learning_goal ?? '',
      retrieval_context: payload.retrievalContext ?? payload.retrieval_context ?? {},
      generation_requirements: payload.generationRequirements ?? payload.generation_requirements ?? {},
    });
  }

  const createdAt = Math.floor(Date.now() / 1000);
  const resources = resourceTypes.map((type, index) => {
    const resourceId = `${type}-${createdAt}-${index + 1}`;
    const content = buildMockResourceContent(type, payload);
    const render = {};

    if (type === 'mindmap') {
      render.mermaid = content.mermaid ?? '';
    } else {
      render.markdown = renderMockMarkdown(type, payload.topic || payload.question || '当前主题', payload.question || '');
    }

    const material = {
      success: true,
      resource_id: resourceId,
      resource_type: type,
      title: content.title || `${payload.topic || payload.question || '资源'} ${type}`,
      topic: content.topic || payload.topic || '',
      syllabus_id: payload.syllabusId ?? payload.syllabus_id ?? null,
      status: 'ready',
      resource_dir: `/mock/${resourceId}`,
      main_files: {},
      validation: { valid: true, method: 'mock' },
      metadata: {},
      created_at: createdAt,
      updated_at: createdAt,
      content,
      render,
    };
    saveMockMaterial(userId, material);
    return material;
  });

  return {
    success: true,
    request: payload,
    resources,
    resource_count: resources.length,
    success_count: resources.length,
    failed_count: 0,
    tool_trace: ['mock_generate'],
    error_message: '',
    error_code: '',
  };
}

export async function listGeneratedResourcesRaw(payload = {}) {
  const userId = requireUserId({ ...payload, allowMockFallback: USE_MOCK_API });

  if (!USE_MOCK_API) {
    return apiPost('/api/generative_list', {
      user_id: userId,
      syllabus_id: payload.syllabusId ?? payload.syllabus_id ?? null,
      resource_type: payload.resourceType ?? payload.resource_type ?? null,
      limit: payload.limit ?? null,
    });
  }

  const syllabusId = payload.syllabusId ?? payload.syllabus_id ?? null;
  const resourceType = normalizeResourceType(payload.resourceType ?? payload.resource_type ?? '');
  let materials = Array.isArray(mockGeneratedStore[userId]) ? mockGeneratedStore[userId] : [];

  if (syllabusId != null) {
    materials = materials.filter((item) => String(item.syllabus_id ?? '') === String(syllabusId));
  }
  if (resourceType) {
    materials = materials.filter((item) => normalizeResourceType(item.resource_type) === resourceType);
  }

  return {
    success: true,
    materials: materials.map((item) => ({
      ...item,
      content: undefined,
      render: undefined,
    })),
    error_message: '',
    error_code: '',
  };
}

export async function getGeneratedResourceDetailRaw(payload = {}) {
  const userId = requireUserId({ ...payload, allowMockFallback: USE_MOCK_API });
  const resourceId = String(payload.resourceId ?? payload.resource_id ?? '').trim();

  if (!USE_MOCK_API) {
    return apiPost('/api/generative_detail', {
      user_id: userId,
      resource_id: resourceId,
    });
  }

  const materials = Array.isArray(mockGeneratedStore[userId]) ? mockGeneratedStore[userId] : [];
  const material = materials.find((item) => String(item.resource_id) === resourceId) ?? null;

  return material
    ? { success: true, material, error_message: '', error_code: '' }
    : { success: false, material: null, error_message: 'not_found', error_code: 'not_found' };
}

export async function generateResources(payload = {}) {
  return parseGenerateResponse(await generateResourcesRaw(payload));
}

export async function listGeneratedResources(payload = {}) {
  return parseListResponse(await listGeneratedResourcesRaw(payload));
}

export async function getGeneratedResourceDetail(payload = {}) {
  return parseDetailResponse(await getGeneratedResourceDetailRaw(payload));
}

export function getGeneratedResourceTypeMeta(type) {
  const normalized = normalizeResourceType(type);

  if (normalized === 'documents') {
    return { label: '讲解文档', tone: 'success' };
  }
  if (normalized === 'mindmap') {
    return { label: '思维导图', tone: 'warning' };
  }
  if (normalized === 'quiz') {
    return { label: '诊断习题', tone: 'danger' };
  }
  if (normalized === 'ppt') {
    return { label: '复习课件', tone: 'neutral' };
  }
  if (normalized === 'coding_practice') {
    return { label: '代码实操', tone: 'success' };
  }
  return { label: normalized || '资源', tone: 'neutral' };
}

export function getCurrentUserIdSafe() {
  return getCurrentUserId();
}

export { normalizeResourceTypeList, parseDetailResponse, parseGenerateResponse, parseListResponse };
