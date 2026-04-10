import { useEffect, useMemo, useState } from 'react';
import MainLayout from '../layouts/MainLayout';
import {
  Button,
  DisabledBlock,
  EmptyState,
  MaterialShelf,
  StatusPill,
  SyllabusSwitcher,
  WeekAxis,
} from '../components/DashboardShared';
import {
  askQuestion,
  getStudentDashboardData,
  initPersonalSyllabus,
  updatePersonalSyllabus,
} from '../api/learning_api';

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

function pickDefaultWeekIndex(personalSyllabus) {
  const period = Array.isArray(personalSyllabus?.period) ? personalSyllabus.period : [];

  return (
    period.find((item) => item.competance === 'weak')?.week_index
    ?? period.find((item) => item.competance === 'none')?.week_index
    ?? period[0]?.week_index
    ?? ''
  );
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

function FileDropzone({ files, onFilesChange, title = '选择文件 / dropbox' }) {
  const [isDragging, setIsDragging] = useState(false);

  const applyFiles = (fileList) => {
    onFilesChange(Array.from(fileList ?? []));
  };

  return (
    <label
      className={['dropzone', 'file-dropzone', isDragging ? 'is-dragging' : ''].filter(Boolean).join(' ')}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragging(false);
        applyFiles(event.dataTransfer?.files);
      }}
    >
      <input
        className="file-dropzone-input"
        type="file"
        multiple
        onChange={(event) => applyFiles(event.target.files)}
      />
      <div className="file-dropzone-copy">
        <strong>{title}</strong>
        <small>
          {files.length
            ? files.map((file) => file.name).join(' / ')
            : '支持点击选择或拖拽到这里'}
        </small>
      </div>
    </label>
  );
}

export default function StudentDashboard({ navigate }) {
  const [syllabuses, setSyllabuses] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [isBooting, setIsBooting] = useState(true);
  const [error, setError] = useState('');
  const [questionInput, setQuestionInput] = useState('');
  const [questionAsked, setQuestionAsked] = useState(false);
  const [answer, setAnswer] = useState('');
  const [askBusy, setAskBusy] = useState(false);
  const [initBusy, setInitBusy] = useState(false);
  const [studyBusy, setStudyBusy] = useState(false);
  const [studyHours, setStudyHours] = useState('2');
  const [selectedWeekIndex, setSelectedWeekIndex] = useState('');
  const [studyRecordFiles, setStudyRecordFiles] = useState([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setIsBooting(true);
      setError('');

      try {
        const response = await getStudentDashboardData();
        if (cancelled) return;
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
  }, []);

  const active = syllabuses.find((item) => item.syllabusId === activeId) ?? syllabuses[0] ?? null;
  const weekOptions = useMemo(() => active?.personalSyllabus?.period ?? [], [active?.personalSyllabus]);
  const currentWeekIndex = useMemo(
    () => getCurrentWeekIndex(active?.dayOneTime, weekOptions.length),
    [active?.dayOneTime, weekOptions.length],
  );
  const disabled = isBooting || !active || !active.isLearning || !active.personalSyllabus;

  useEffect(() => {
    if (!weekOptions.length) {
      setSelectedWeekIndex('');
      return;
    }

    const stillExists = weekOptions.some((item) => String(item.week_index) === String(selectedWeekIndex));
    if (!stillExists) {
      setSelectedWeekIndex(String(pickDefaultWeekIndex(active?.personalSyllabus)));
    }
  }, [active?.personalSyllabus, selectedWeekIndex, weekOptions]);

  const patchActive = (updater) => {
    setSyllabuses((current) =>
      current.map((item) => (item.syllabusId === activeId ? updater(cloneData(item)) : item)),
    );
  };

  const switchSyllabus = (offset) => {
    if (!syllabuses.length) return;
    const currentIndex = syllabuses.findIndex((item) => item.syllabusId === activeId);
    const nextIndex = (currentIndex + offset + syllabuses.length) % syllabuses.length;
    setActiveId(syllabuses[nextIndex].syllabusId);
    setQuestionAsked(false);
    setQuestionInput('');
    setAnswer('');
    setStudyRecordFiles([]);
  };

  const recommendationItems = questionAsked
    ? active?.recommendedMaterials ?? []
    : active?.defaultRecommendations ?? [];

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
              if (!active) return;
              setInitBusy(true);
              setError('');

              try {
                await initPersonalSyllabus({ userId: 7, syllabusId: active.syllabusId });
                patchActive((item) => {
                  item.isLearning = true;
                  item.personalSyllabus ??= {
                    syllabus_id: item.syllabusId,
                    user_id: 7,
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
                {questionAsked ? 'AI 推荐' : 'syllabus-file'}
              </StatusPill>
            </div>
          ) : null}
        </section>

        {error ? <EmptyState>{error}</EmptyState> : null}
        {!error && !active && !isBooting ? <EmptyState>暂无教学大纲。</EmptyState> : null}

        {active ? (
          <section className="dashboard-grid dashboard-grid-student">
            <article className="tile-card tile-teal tile-span-full">
              <div className="tile-card-head">
                <h3>个人教学大纲</h3>
                <StatusPill tone={disabled ? 'warning' : 'success'}>
                  {disabled ? '待初始化' : '可交互'}
                </StatusPill>
              </div>
              <DisabledBlock disabled={disabled} message="请先点击“选择学习”初始化 personal_syllabus">
                <WeekAxis
                  items={active.personalSyllabus?.period ?? []}
                  mode="competance"
                  currentWeek={currentWeekIndex}
                />
              </DisabledBlock>
            </article>

            <article className="tile-card tile-blue tile-half">
              <div className="tile-card-head">
                <h3>提问</h3>
                <StatusPill tone={questionAsked ? 'success' : 'neutral'}>
                  {questionAsked ? '已提问' : '待提问'}
                </StatusPill>
              </div>
              <DisabledBlock disabled={disabled} message="请先选择学习">
                <div className="question-grid">
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
                              userId: 7,
                              syllabusId: active.syllabusId,
                              question: questionInput,
                            });
                            setQuestionAsked(true);
                            setAnswer(response.answer);
                            patchActive((item) => {
                              item.recommendedMaterials = response.recommendedMaterials;
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
                  <section className="response-panel">
                    <strong className="response-title">回答</strong>
                    <p className="response-copy">{answer || '尚未提问。'}</p>
                  </section>
                </div>
              </DisabledBlock>
            </article>

            <article className="tile-card tile-slate tile-half">
              <div className="tile-card-head">
                <h3>推荐材料</h3>
                <StatusPill tone={questionAsked ? 'success' : 'warning'}>
                  {questionAsked ? 'AI' : 'syllabus-file'}
                </StatusPill>
              </div>
              <DisabledBlock disabled={disabled} message="请先选择学习">
                <MaterialShelf items={recommendationItems} emptyText="暂无可展示的推荐材料。" />
              </DisabledBlock>
            </article>

            <article className="tile-card tile-amber tile-span-full">
              <div className="tile-card-head">
                <h3>学习内容记录</h3>
                <StatusPill tone={disabled ? 'warning' : 'success'}>
                  {disabled ? '不可提交' : '可提交'}
                </StatusPill>
              </div>
              <DisabledBlock disabled={disabled} message="请先选择学习">
                <div className="study-record-grid">
                  <section className="study-mode">
                    <strong className="study-mode-title">方式 A</strong>
                    <FileDropzone
                      files={studyRecordFiles}
                      onFilesChange={setStudyRecordFiles}
                      title="上传学习记录 / dropbox"
                    />
                    <label className="field">
                      <span>补充说明</span>
                      <textarea rows="3" placeholder="输入学习记录说明" />
                    </label>
                  </section>
                  <section className="study-mode">
                    <strong className="study-mode-title">方式 B</strong>
                    <label className="field">
                      <span>学习周次</span>
                      <select
                        className="select-field"
                        value={selectedWeekIndex}
                        onChange={(event) => setSelectedWeekIndex(event.target.value)}
                      >
                        <option value="">请选择周次</option>
                        {weekOptions.map((item) => (
                          <option key={item.week_index} value={item.week_index}>
                            {`第${item.week_index}周`}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>付出小时数</span>
                      <input
                        inputMode="numeric"
                        value={studyHours}
                        onChange={(event) => setStudyHours(event.target.value)}
                      />
                    </label>
                    <div className="tile-actions">
                      <Button
                        variant="primary"
                        disabled={studyBusy || !selectedWeekIndex}
                        onClick={async () => {
                          setStudyBusy(true);
                          setError('');

                          try {
                            const response = await updatePersonalSyllabus({
                              userId: 7,
                              syllabusId: active.syllabusId,
                              weekIndex: Number(selectedWeekIndex),
                              studyTimeSpent: Number(studyHours) || 0,
                            });

                            if (!response.success || !response.syllabus) {
                              throw new Error(response.errorMessage || '提交失败');
                            }

                            patchActive((item) => {
                              item.personalSyllabus = response.syllabus;
                              return item;
                            });
                          } catch (actionError) {
                            setError(actionError instanceof Error ? actionError.message : '提交记录失败');
                          } finally {
                            setStudyBusy(false);
                          }
                        }}
                      >
                        {studyBusy ? '处理中...' : '提交记录'}
                      </Button>
                    </div>
                  </section>
                </div>
              </DisabledBlock>
            </article>
          </section>
        ) : null}
      </section>
    </MainLayout>
  );
}
