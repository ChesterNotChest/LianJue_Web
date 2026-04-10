function Button({ children, variant = 'secondary', disabled = false, ...props }) {
  return (
    <button type="button" className={`button button-${variant}`} disabled={disabled} {...props}>
      {children}
    </button>
  );
}

function StatusPill({ children, tone = 'neutral' }) {
  return <span className={`status-pill status-pill-${tone}`}>{children}</span>;
}

function EmptyState({ children }) {
  return <div className="resource-empty">{children}</div>;
}

function Stepper({ steps, currentStep, allowStep, onSelect }) {
  return (
    <div className="stepper">
      {steps.map((step, index) => {
        const isActive = index === currentStep;
        const isDone = index < currentStep;
        const isLocked = !allowStep(index);

        return (
          <button
            key={step}
            type="button"
            className={['stepper-item', isActive ? 'is-active' : '', isDone ? 'is-done' : '', isLocked ? 'is-locked' : ''].filter(Boolean).join(' ')}
            onClick={() => onSelect(index)}
            disabled={isLocked}
          >
            <span className="stepper-index">{index + 1}</span>
            <span className="stepper-label">{step}</span>
          </button>
        );
      })}
    </div>
  );
}

function ModalShell({ title, children, onClose }) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="modal-shell"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <h2>{title}</h2>
          <Button variant="ghost" onClick={onClose}>关闭</Button>
        </header>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}

function SyllabusSwitcher({ items, activeId, onChange, onPrev, onNext, disabled = false, learningLabel }) {
  const current = items.find((item) => (item.syllabusId ?? item.syllabus_id) === activeId) ?? items[0];

  return (
    <section className={`switcher-bar ${disabled ? 'is-disabled-block' : ''}`}>
      <div className="switcher-nav">
        <Button variant="ghost" disabled={disabled || items.length <= 1} onClick={onPrev}>上一份</Button>
        <div className="switcher-center">
          <select
            className="select-field"
            value={activeId}
            onChange={(event) => onChange(Number(event.target.value))}
            disabled={disabled}
          >
            {items.map((item) => {
              const itemId = item.syllabusId ?? item.syllabus_id;
              return <option key={itemId} value={itemId}>{item.title}</option>;
            })}
          </select>
        </div>
        <Button variant="ghost" disabled={disabled || items.length <= 1} onClick={onNext}>下一份</Button>
      </div>
      <div className="switcher-meta">
        {current?.permission ? (
          <StatusPill tone={current.permission === 'owner' ? 'success' : 'neutral'}>
            {current.permission}
          </StatusPill>
        ) : null}
        {typeof current?.isLearning === 'boolean' ? (
          <StatusPill tone={current.isLearning ? 'success' : 'warning'}>
            {learningLabel ?? (current.isLearning ? '学习中' : '未学习')}
          </StatusPill>
        ) : null}
        {current?.graphName ? <StatusPill tone="neutral">{current.graphName}</StatusPill> : null}
      </div>
    </section>
  );
}

function DisabledBlock({ disabled, message, children }) {
  return (
    <div className="disabled-wrap">
      {children}
      {disabled ? <div className="disabled-overlay"><strong>{message}</strong></div> : null}
    </div>
  );
}

function getCompetanceLabel(level) {
  switch (level) {
    case 'weak':
      return '待巩固';
    case 'normal':
      return '基本达标';
    case 'master':
      return '熟练掌握';
    case 'none':
      return '尚未开始';
    default:
      return level ?? '';
  }
}

function getTimelineState(weekIndex, currentWeek) {
  if (currentWeek == null) {
    return 'future';
  }

  const normalizedWeek = Number(weekIndex);
  const normalizedCurrentWeek = Number(currentWeek);

  if (normalizedWeek < normalizedCurrentWeek) {
    return 'past';
  }

  if (normalizedWeek === normalizedCurrentWeek) {
    return 'current';
  }

  return 'future';
}

function getImportanceLabel(level) {
  switch (level) {
    case 'high':
      return '难';
    case 'medium':
      return '中';
    case 'low':
      return '易';
    default:
      return '';
  }
}

function WeekAxis({ items, mode = 'importance', currentWeek = null, renderContent }) {
  const list = Array.isArray(items) ? items : [];

  if (!list.length) {
    return <EmptyState>暂无数据。</EmptyState>;
  }

  return (
    <div className={`week-axis week-axis-${mode}`}>
      <div className="week-axis-track">
        {list.map((item) => {
          const tone = mode === 'competance' ? item.competance : item.importance ?? 'medium';
          const isCurrent = currentWeek != null && Number(item.week_index) === Number(currentWeek);
          const weekLabel = `第${item.week_index}周`;
          const timelineState = getTimelineState(item.week_index, currentWeek);
          const importanceLabel = getImportanceLabel(item.importance);

          return (
            <article
              key={item.week_index}
              className={['week-axis-card', `tone-${tone}`, `time-${timelineState}`, isCurrent ? 'is-current' : ''].filter(Boolean).join(' ')}
            >
              <div className="week-axis-card-head">
                <span className="week-axis-index">{weekLabel}</span>
                {mode === 'competance' ? (
                  <div className="week-axis-status-stack">
                    <StatusPill tone={tone === 'master' ? 'success' : tone === 'weak' ? 'danger' : tone === 'none' ? 'neutral' : 'warning'}>
                      {getCompetanceLabel(tone)}
                    </StatusPill>
                    {importanceLabel ? (
                      <StatusPill tone={item.importance === 'high' ? 'danger' : item.importance === 'medium' ? 'warning' : 'neutral'}>
                        {importanceLabel}
                      </StatusPill>
                    ) : null}
                  </div>
                ) : (
                  <StatusPill tone={tone === 'high' ? 'danger' : tone === 'medium' ? 'warning' : 'neutral'}>{tone}</StatusPill>
                )}
              </div>
              <div className="week-axis-ruler">
                <span className="week-axis-ruler-label">{weekLabel}</span>
                <span className="week-axis-ruler-dot" />
              </div>
              {renderContent ? renderContent(item) : <p className="week-axis-content">{item.enhanced_content ?? item.content ?? ''}</p>}
              {mode === 'competance'
                ? <small className="week-axis-foot">{`progress ${item.competance_progress ?? 0}`}</small>
                : item.day_one ? <small className="week-axis-foot">{`day_one ${item.day_one}`}</small> : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}

function MaterialShelf({ items, emptyText = '暂无材料。', rows = 2 }) {
  if (!items.length) {
    return <EmptyState>{emptyText}</EmptyState>;
  }

  return (
    <div className="material-shelf">
      <div className={`material-shelf-grid ${rows === 1 ? 'is-single-row' : ''}`}>
        {items.map((item, index) => (
          <article key={`${item.title}-${index}`} className="material-chip-card">
            <div className="material-chip-head">
              <strong>{item.title}</strong>
              {item.tagText ? <StatusPill tone={item.tagTone ?? 'neutral'}>{item.tagText}</StatusPill> : null}
            </div>
            <small>
              {item.source}
              {item.weekLabel ? ` / ${item.weekLabel}` : ''}
            </small>
          </article>
        ))}
      </div>
    </div>
  );
}

export {
  Button,
  DisabledBlock,
  EmptyState,
  MaterialShelf,
  ModalShell,
  StatusPill,
  Stepper,
  SyllabusSwitcher,
  WeekAxis,
};
