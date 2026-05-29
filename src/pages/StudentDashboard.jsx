import { useEffect, useMemo, useState } from 'react';
import MainLayout from '../layouts/MainLayout';
import {
  Button,
  DisabledBlock,
  EmptyState,
  LoadingPlaceholder,
  MaterialShelf,
  StatusPill,
  SyllabusSwitcher,
  WeekAxis,
} from '../components/DashboardShared';
import {
  askQuestion,
  getPersonalSyllabus,
  getLearningProfile,
  getStudentDashboardData,
  initPersonalSyllabus,
} from '../api/learning_api';
import { downloadFile } from '../api/file_transmit_api';
import { getCurrentUserId } from '../api/session';

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

function getCurrentWeekIndex(dayOneTime, periodLength) {
  if (!dayOneTime || !periodLength) {
    return null;
  }

  const dayOneDate = new Date(dayOneTime);
  if (Number.isNaN(dayOneDate.getTime())) {
    return null;
  }

  const diffMs = Date.now() - dayOneDate.getTime();
  if (diffMs < 0) {
    return 1;
  }

  const weekIndex = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000)) + 1;
  return Math.min(Math.max(weekIndex, 1), periodLength);
}

const DEFAULT_PROFILE_METRICS = [
  { key: 'overall_score', label: 'overall_score' },
  { key: 'answer_score', label: 'answer_score' },
  { key: 'syllabus_score', label: 'syllabus_score' },
  { key: 'engagement_score', label: 'engagement_score' },
  { key: 'mastered_weeks', label: 'mastered_weeks' },
  { key: 'overall_level', label: 'overall_level' },
  { key: 'by_knowledge_point', label: 'by_knowledge_point' },
  { key: 'knowledge_point_details', label: 'knowledge_point_details' },
];

function createEmptyLearningProfile(userId = null, syllabusId = null) {
  return {
    user_id: userId,
    syllabus_id: syllabusId,
    learning_goal: null,
    target_level: null,
    learning_style: null,
    study_frequency: null,
    study_duration: null,
    bottleneck_topics: [],
    dropout_risk: null,
    knowledge_mastery: {
      overall_score: 0,
      answer_score: 0,
      syllabus_score: 0,
      engagement_score: 0,
      mastered_weeks: 0,
      overall_level: 0,
      by_knowledge_point: 0,
      knowledge_point_details: 0,
    },
  };
}

export default function StudentDashboard({ navigate }) {
  const [syllabuses, setSyllabuses] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [isBooting, setIsBooting] = useState(true);
  const [error, setError] = useState('');
  const [learningProfile, setLearningProfile] = useState(() => createEmptyLearningProfile());
  const [dialogueTextForProfile, setDialogueTextForProfile] = useState('');
  const [advancedJsonText, setAdvancedJsonText] = useState('');
  const [profileLoading, setProfileLoading] = useState(false);
  const [questionInput, setQuestionInput] = useState('');
  const [questionAsked, setQuestionAsked] = useState(false);
  const [answer, setAnswer] = useState('');
  const [askBusy, setAskBusy] = useState(false);
  const [initBusy, setInitBusy] = useState(false);
  const [expandedTimelineWeekId, setExpandedTimelineWeekId] = useState(null);
  const [isAnswerExpanded, setIsAnswerExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!getCurrentUserId()) {
        navigate('/login');
        setIsBooting(false);
        return;
      }

      setIsBooting(true);
      setError('');

      try {
        const response = await getStudentDashboardData();
        if (cancelled) {
          return;
        }
        setSyllabuses(response.syllabuses);
        setActiveId(response.syllabuses[0]?.syllabusId ?? null);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : '加载失败');
        }
      } finally {
        if (!cancelled) {
          window.setTimeout(() => setIsBooting(false), 240);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  useEffect(() => {
    if (!activeId || isBooting) {
      return undefined;
    }

    const activeSyllabus = syllabuses.find((item) => item.syllabusId === activeId) ?? null;
    if (!activeSyllabus) {
      return undefined;
    }

    let cancelled = false;
    const fallbackProfile = createEmptyLearningProfile(getCurrentUserId(), activeSyllabus.syllabusId);

    setLearningProfile(fallbackProfile);

    async function loadLearningProfile() {
      try {
        const profileRes = await getLearningProfile({
          syllabusId: activeSyllabus.syllabusId,
        });
        if (cancelled) {
          return;
        }

        setLearningProfile(profileRes?.profile ?? fallbackProfile);
      } catch {
        if (!cancelled) {
          setLearningProfile(fallbackProfile);
        }
      }
    }

    void loadLearningProfile();

    return () => {
      cancelled = true;
    };
  }, [activeId, isBooting, syllabuses]);

  const active = syllabuses.find((item) => item.syllabusId === activeId) ?? syllabuses[0] ?? null;
  const currentWeekIndex = useMemo(
    () => getCurrentWeekIndex(active?.dayOneTime, active?.personalSyllabus?.period?.length ?? 0),
    [active?.dayOneTime, active?.personalSyllabus?.period?.length],
  );
  const disabled = isBooting || !active || !active.isLearning || !active.personalSyllabus;
  const showStudentShell = Boolean(active) || isBooting;
  const isStudentLoading = isBooting && !active;

  useEffect(() => {
    setExpandedTimelineWeekId(null);
    setIsAnswerExpanded(false);
  }, [activeId]);

  const patchActive = (updater) => {
    setSyllabuses((current) => current.map((item) => (
      item.syllabusId === activeId ? updater(cloneData(item)) : item
    )));
  };

  const switchSyllabus = (offset) => {
    if (!syllabuses.length) {
      return;
    }

    const currentIndex = syllabuses.findIndex((item) => item.syllabusId === activeId);
    const nextIndex = (currentIndex + offset + syllabuses.length) % syllabuses.length;
    setActiveId(syllabuses[nextIndex].syllabusId);
    setQuestionAsked(false);
    setQuestionInput('');
    setAnswer('');
  };

  const recommendationItems = questionAsked
    ? active?.recommendedMaterials ?? []
    : active?.defaultRecommendations ?? [];
  const recommendationDownloadItems = recommendationItems.map((item) => ({
    ...item,
    onDownload: async (downloadItem) => {
      try {
        const result = await downloadFile(downloadItem.fileId, downloadItem.title);
        if (!result.success) {
          throw new Error(result.error_message || '下载失败');
        }
      } catch (actionError) {
        setError(actionError instanceof Error ? actionError.message : '下载失败');
      }
    },
  }));

  return (
    <MainLayout
      title="学生 Dashboard"
      actions={(
        <div className="header-actions">
          <Button variant="secondary" onClick={() => navigate('/login')}>返回登录</Button>
          <Button
            variant="primary"
            disabled={!active || initBusy}
            onClick={async () => {
              if (!active) {
                return;
              }

              setInitBusy(true);
              setError('');

              try {
                const currentUserId = getCurrentUserId();
                await initPersonalSyllabus({ syllabusId: active.syllabusId });
                const personalSyllabus = await getPersonalSyllabus({ syllabusId: active.syllabusId });
                patchActive((item) => {
                  item.isLearning = true;
                  item.personalSyllabus = personalSyllabus ?? item.personalSyllabus ?? {
                    syllabus_id: item.syllabusId,
                    user_id: currentUserId,
                    review_count: 0,
                    reviewed_at: 0,
                    period: [],
                  };
                  return item;
                });
              } catch (actionError) {
                setError(actionError instanceof Error ? actionError.message : '初始化失败');
              } finally {
                setInitBusy(false);
              }
            }}
          >
            {active?.isLearning ? '已选择学习' : initBusy ? '处理中...' : '选择学习'}
          </Button>
        </div>
      )}
    >
      <section className="dashboard-shell">
        <section className="dashboard-hero">
          <SyllabusSwitcher
            items={syllabuses}
            activeId={activeId ?? 0}
            onChange={setActiveId}
            onPrev={() => switchSyllabus(-1)}
            onNext={() => switchSyllabus(1)}
            disabled={isBooting || !syllabuses.length}
            learningLabel={active?.isLearning ? '学习中' : '未学习'}
          />
          {active ? (
            <div className="status-strip">
              <StatusPill tone={active.isLearning && active.personalSyllabus ? 'success' : 'warning'}>
                {active.isLearning && active.personalSyllabus ? 'personal_syllabus 已就绪' : '待初始化'}
              </StatusPill>
              <StatusPill tone={questionAsked ? 'success' : 'neutral'}>
                {questionAsked ? 'AI 推荐' : '默认推荐'}
              </StatusPill>
            </div>
          ) : null}
        </section>

        {active ? (
          <section
            className="tile-card tile-span-full"
            style={{ padding: 20, display: 'grid', gap: 16 }}
          >
            <div className="tile-card-head">
              <h3>Learning Profile</h3>
              <StatusPill tone="success">
                loaded
              </StatusPill>
            </div>

            <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <label className="field" style={{ flex: '1 1 420px', minWidth: 320 }}>
                <span>Recent dialogue summary</span>
                <textarea
                  rows={3}
                  value={dialogueTextForProfile}
                  placeholder="Optional. Add recent learning goals or conversation context."
                  onChange={(event) => setDialogueTextForProfile(event.target.value)}
                />
              </label>

              <div style={{ flex: '1 1 320px', minWidth: 280, display: 'grid', gap: 8 }}>
                <label className="field" style={{ marginBottom: 0 }}>
                  <span>Advanced payload (JSON)</span>
                  <textarea
                    rows={3}
                    value={advancedJsonText}
                    placeholder='Optional. Example: {"learning_records":[...],"answer_records":[...]}'
                    onChange={(event) => setAdvancedJsonText(event.target.value)}
                  />
                </label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <Button
                    variant="primary"
                    disabled={profileLoading}
                    onClick={async () => {
                      setProfileLoading(true);
                      setError('');

                      try {
                        let extra = {};
                        if (advancedJsonText.trim()) {
                          try {
                            const parsed = JSON.parse(advancedJsonText);
                            extra = parsed && typeof parsed === 'object' ? parsed : {};
                          } catch {
                            throw new Error('Advanced payload JSON is invalid.');
                          }
                        }

                        const response = await getLearningProfile({
                          syllabusId: active.syllabusId,
                          dialogueText: dialogueTextForProfile || undefined,
                          ...extra,
                        });

                        if (!response?.success) {
                          throw new Error(response?.errorMessage || 'Learning profile request failed.');
                        }

                        setLearningProfile(response.profile ?? createEmptyLearningProfile(getCurrentUserId(), active.syllabusId));
                      } catch (actionError) {
                        setError(actionError instanceof Error ? actionError.message : 'Learning profile request failed.');
                        setLearningProfile(createEmptyLearningProfile(getCurrentUserId(), active.syllabusId));
                      } finally {
                        setProfileLoading(false);
                      }
                    }}
                  >
                    {profileLoading ? 'Refreshing...' : 'Refresh profile'}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setDialogueTextForProfile('');
                      setAdvancedJsonText('');
                    }}
                  >
                    Clear inputs
                  </Button>
                </div>
              </div>
            </div>

            {learningProfile ? (
              <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 320px', minWidth: 280, display: 'grid', gap: 10 }}>
                  <div><strong>Goal:</strong> {learningProfile.learning_goal ?? 'Not provided'}</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <StatusPill tone="neutral">Level: {learningProfile.target_level ?? 'unknown'}</StatusPill>
                    <StatusPill tone="neutral">Style: {learningProfile.learning_style ?? 'unknown'}</StatusPill>
                    <StatusPill tone="neutral">Frequency: {learningProfile.study_frequency ?? 'unknown'}</StatusPill>
                    <StatusPill tone="neutral">Duration: {learningProfile.study_duration ?? 'unknown'}</StatusPill>
                  </div>
                  <div><strong>Risk:</strong> {learningProfile.dropout_risk ?? 'unknown'}</div>
                  <div>
                    <strong>Bottlenecks:</strong>{' '}
                    {Array.isArray(learningProfile.bottleneck_topics) && learningProfile.bottleneck_topics.length
                      ? learningProfile.bottleneck_topics.join(', ')
                      : 'none'}
                  </div>
                </div>

                <div style={{ flex: '1 1 360px', minWidth: 300, display: 'grid', gap: 8 }}>
                  <strong>Knowledge mastery</strong>
                  {DEFAULT_PROFILE_METRICS.map((metric) => {
                    const rawValue = learningProfile.knowledge_mastery?.[metric.key] ?? 0;
                    const numericValue = Number(rawValue);
                    const percent = Number.isFinite(numericValue)
                      ? Math.max(0, Math.min(100, Math.round(numericValue * 100)))
                      : 0;

                    return (
                      <div key={metric.key} style={{ display: 'grid', gridTemplateColumns: '140px 1fr 48px', gap: 8, alignItems: 'center' }}>
                        <span style={{ fontSize: 13 }}>{metric.label}</span>
                        <div style={{ height: 10, background: '#e5e7eb', borderRadius: 999, overflow: 'hidden' }}>
                          <div style={{ width: `${percent}%`, height: '100%', background: '#0f766e' }} />
                        </div>
                        <span style={{ fontSize: 12, textAlign: 'right' }}>{percent}%</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </section>
        ) : null}

        {error ? <EmptyState>{error}</EmptyState> : null}
        {!error && !active && !isBooting ? <EmptyState>暂无教学大纲。</EmptyState> : null}

        {showStudentShell ? (
          <section className="dashboard-grid dashboard-grid-student">
            <article className="tile-card tile-teal tile-span-full">
              <div className="tile-card-head">
                <h3>个人教学大纲</h3>
                <div className="tile-head-controls">
                  <StatusPill tone={disabled ? 'warning' : 'success'}>
                    {disabled ? '待初始化' : '可交互'}
                  </StatusPill>
                </div>
              </div>
              {isStudentLoading ? (
                <LoadingPlaceholder size="axis" />
              ) : (
                <DisabledBlock disabled={disabled} message="请先点击“选择学习”初始化 personal_syllabus">
                  <WeekAxis
                    items={active.personalSyllabus?.period ?? []}
                    mode="competance"
                    currentWeek={currentWeekIndex}
                    expandedItemId={expandedTimelineWeekId}
                    onToggleExpand={(itemId) => {
                      setExpandedTimelineWeekId((current) => (current === itemId ? null : itemId));
                    }}
                  />
                </DisabledBlock>
              )}
            </article>

            <div className={['student-focus-row', isAnswerExpanded ? 'is-answer-expanded' : ''].filter(Boolean).join(' ')}>
              <article className="tile-card tile-blue student-question-tile">
                <div className="tile-card-head">
                  <h3>提问</h3>
                  <div className="tile-head-controls">
                    <StatusPill tone={questionAsked ? 'success' : 'neutral'}>
                      {questionAsked ? '已提问' : '待提问'}
                    </StatusPill>
                    <Button variant="ghost" onClick={() => setIsAnswerExpanded((current) => !current)}>
                      {isAnswerExpanded ? '收起' : '展开回答'}
                    </Button>
                  </div>
                </div>
                {isStudentLoading ? (
                  <LoadingPlaceholder size="answer" />
                ) : (
                  <DisabledBlock disabled={disabled} message="请先选择学习">
                    <div className={['question-grid', isAnswerExpanded ? 'is-answer-expanded' : ''].filter(Boolean).join(' ')}>
                      <section className="response-panel">
                        <label className="field">
                          <span>问题</span>
                          <textarea
                            rows="4"
                            value={questionInput}
                            placeholder="例如：ETL 在这里具体负责什么？"
                            onChange={(event) => setQuestionInput(event.target.value)}
                          />
                        </label>
                        <div className="tile-actions">
                          <Button
                            variant="primary"
                            disabled={askBusy || !questionInput.trim()}
                            onClick={async () => {
                              setAskBusy(true);
                              setError('');

                              try {
                                const response = await askQuestion({
                                  syllabusId: active.syllabusId,
                                  question: questionInput,
                                });
                                const personalSyllabus = await getPersonalSyllabus({ syllabusId: active.syllabusId });
                                setQuestionAsked(true);
                                setAnswer(response.answer);
                                patchActive((item) => {
                                  item.recommendedMaterials = response.recommendedMaterials;
                                  item.personalSyllabus = personalSyllabus ?? item.personalSyllabus;
                                  return item;
                                });
                              } catch (actionError) {
                                setError(actionError instanceof Error ? actionError.message : '提问失败');
                              } finally {
                                setAskBusy(false);
                              }
                            }}
                          >
                            {askBusy ? '处理中...' : '提交提问'}
                          </Button>
                        </div>
                      </section>
                      <section className={['response-panel', 'response-panel-answer', isAnswerExpanded ? 'is-expanded' : ''].filter(Boolean).join(' ')}>
                        <strong className="response-title">回答</strong>
                        <p className={['response-copy', isAnswerExpanded ? 'is-expanded' : 'is-condensed'].filter(Boolean).join(' ')}>
                          {answer || '尚未提问。'}
                        </p>
                      </section>
                    </div>
                  </DisabledBlock>
                )}
              </article>

              <article className="tile-card tile-slate student-recommendation-tile">
                <div className="tile-card-head">
                  <h3>推荐材料</h3>
                  <StatusPill tone={questionAsked ? 'success' : 'warning'}>
                    {questionAsked ? 'AI' : '默认'}
                  </StatusPill>
                </div>
                {isStudentLoading ? (
                  <LoadingPlaceholder size="shelf" />
                ) : (
                  <DisabledBlock disabled={disabled} message="请先选择学习">
                    <MaterialShelf items={recommendationDownloadItems} emptyText="暂无可展示的推荐材料。" />
                  </DisabledBlock>
                )}
              </article>
            </div>
          </section>
        ) : null}
      </section>
    </MainLayout>
  );
}
