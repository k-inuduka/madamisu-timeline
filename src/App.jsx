import { useEffect, useMemo, useState } from 'react'

const MAX_CHARACTERS = 10
const PX_PER_MINUTE = 2
const TICK_MINUTES = 30
const BAR_LANE_HEIGHT = 34
const URL_DATA_KEY = 'data'
const URL_TIMELINE_ID_KEY = 'id'
const URL_BLANK_KEY = 'blank'
const STORAGE_DOC_PREFIX = 'madamisu-timeline:doc:'
const STORAGE_VERSION = 1
const TIME_STEP_MINUTES = 5
const DEFAULT_ACTION_MINUTES = 30
const MIN_ACTION_MINUTES = 5
const MAX_TIMELINE_MEMO_LENGTH = 10000

const ACTION_COLORS = [
  { label: '緑', value: '#2f9e44' },
  { label: '青', value: '#1f6feb' },
  { label: '赤', value: '#d94841' },
  { label: '紫', value: '#845ef7' },
  { label: '橙', value: '#e8590c' },
  { label: '水色', value: '#0b7285' },
  { label: '桃', value: '#c2255c' },
  { label: '茶', value: '#795548' },
  { label: '灰', value: '#586069' },
  { label: '紺', value: '#364fc7' },
]

const defaultDraft = {
  start: '20:00',
  end: '20:30',
  place: '',
  memo: '',
  witnessIds: [],
}

const initialCharacters = [
  {
    id: 1,
    name: '探偵',
    color: ACTION_COLORS[0].value,
    actions: [{ id: 101, start: '20:00', end: '20:50', place: '食堂', memo: '', witnessIds: [] }],
  },
  {
    id: 2,
    name: '医者',
    color: ACTION_COLORS[1].value,
    actions: [{ id: 201, start: '20:30', end: '21:40', place: '書斎', memo: '', witnessIds: [] }],
  },
  {
    id: 3,
    name: '執事',
    color: ACTION_COLORS[4].value,
    actions: [{ id: 301, start: '20:00', end: '20:35', place: '庭', memo: '', witnessIds: [] }],
  },
]

function cloneInitialCharacters() {
  return initialCharacters.map((character) => ({
    ...character,
    actions: character.actions.map((action) => ({ ...action })),
  }))
}

function parseTime(time) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(time))
  if (!match) return null

  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null

  return hours * 60 + minutes
}

function toMinutes(time) {
  return parseTime(time) ?? 0
}

function toTime(minutes) {
  const normalizedMinutes = ((minutes % 1440) + 1440) % 1440
  const hours = Math.floor(normalizedMinutes / 60)
  const mins = normalizedMinutes % 60
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
}

function roundToTimeStep(minutes) {
  return Math.round(minutes / TIME_STEP_MINUTES) * TIME_STEP_MINUTES
}

function roundDurationToStep(minutes) {
  return Math.max(MIN_ACTION_MINUTES, roundToTimeStep(minutes))
}

function toStepTime(time, fallback) {
  const minutes = parseTime(time)
  if (minutes === null) return fallback
  return toTime(roundToTimeStep(minutes))
}

function makeId(index = 0) {
  return Date.now() + index + Math.floor(Math.random() * 1000)
}

function makeTimelineId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID()

  return `timeline-${Date.now()}-${Math.floor(Math.random() * 100000)}`
}

function isColor(value) {
  return ACTION_COLORS.some((color) => color.value === value)
}

function getUsedCharacterColors(characters, ignoreCharacterId = null) {
  return new Set(
    characters
      .filter((character) => character.id !== ignoreCharacterId && isColor(character.color))
      .map((character) => character.color),
  )
}

function getUnusedColor(usedColors, preferredColor = null) {
  if (isColor(preferredColor) && !usedColors.has(preferredColor)) return preferredColor

  return ACTION_COLORS.find((color) => !usedColors.has(color.value))?.value || null
}

function normalizeWitnessIds(rawWitnessIds, validCharacterIds, ownerCharacterId = null) {
  if (!Array.isArray(rawWitnessIds)) return []

  const witnessIds = []

  rawWitnessIds.forEach((rawWitnessId) => {
    const witnessId = Number(rawWitnessId)

    if (!validCharacterIds.has(witnessId)) return
    if (witnessId === ownerCharacterId) return
    if (witnessIds.includes(witnessId)) return

    witnessIds.push(witnessId)
  })

  return witnessIds
}

function getWitnessNames(witnessIds, characters) {
  return getWitnesses(witnessIds, characters).map((witness) => witness.name).filter(Boolean)
}

function getWitnesses(witnessIds, characters) {
  if (!Array.isArray(witnessIds) || witnessIds.length === 0) return []

  return witnessIds
    .map((witnessId) => characters.find((character) => character.id === witnessId))
    .filter(Boolean)
}

function getActionEndMinute(action) {
  const startMinute = toMinutes(action.start)
  let endMinute = toMinutes(action.end)

  if (endMinute <= startMinute) endMinute += 24 * 60

  return endMinute
}

function getActionDuration(action) {
  return Math.max(MIN_ACTION_MINUTES, getActionEndMinute(action) - toMinutes(action.start))
}

function normalizeCharacters(rawCharacters) {
  if (!Array.isArray(rawCharacters)) return null

  const usedColors = new Set()

  const normalizedCharacters = rawCharacters.slice(0, MAX_CHARACTERS).map((character, characterIndex) => {
    const actions = Array.isArray(character.actions) ? character.actions : []
    const fallbackColor = ACTION_COLORS[characterIndex % ACTION_COLORS.length].value
    const color = getUnusedColor(usedColors, character.color) || fallbackColor

    usedColors.add(color)

    return {
      id: Number(character.id) || makeId(characterIndex),
      name: String(character.name || '').slice(0, 20),
      color,
      actions: actions.map((action, actionIndex) => {
        const start = toStepTime(action.start, '20:00')
        const duration = roundDurationToStep(Number(action.duration) || DEFAULT_ACTION_MINUTES)
        let end = toStepTime(action.end, '')

        if (!end) end = toTime(toMinutes(start) + duration)
        if (end === start) end = toTime(toMinutes(start) + MIN_ACTION_MINUTES)

        const hasPlace = typeof action.place === 'string' && action.place.trim()
        const place = String(hasPlace ? action.place : action.memo || '場所未設定').slice(0, 80)
        const memo = String(hasPlace ? action.memo || '' : '').slice(0, 200)

        return {
          id: Number(action.id) || makeId(actionIndex),
          start,
          end,
          place,
          memo,
          witnessIds: Array.isArray(action.witnessIds) ? action.witnessIds : [],
        }
      }),
    }
  })

  const validCharacterIds = new Set(normalizedCharacters.map((character) => character.id))

  return normalizedCharacters.map((character) => ({
    ...character,
    actions: character.actions.map((action) => ({
      ...action,
      witnessIds: normalizeWitnessIds(action.witnessIds, validCharacterIds, character.id),
    })),
  }))
}

function normalizeTimelineMemo(rawMemo) {
  return String(rawMemo || '').slice(0, MAX_TIMELINE_MEMO_LENGTH)
}

function normalizeDocument(rawDocument) {
  if (Array.isArray(rawDocument)) {
    return {
      characters: normalizeCharacters(rawDocument) || [],
      timelineMemo: '',
    }
  }

  if (!rawDocument || typeof rawDocument !== 'object') return null

  return {
    characters: normalizeCharacters(rawDocument.characters) || [],
    timelineMemo: normalizeTimelineMemo(rawDocument.timelineMemo),
  }
}

function makeInitialDocument() {
  return {
    characters: cloneInitialCharacters(),
    timelineMemo: '',
  }
}

function makeBlankDocument() {
  return {
    characters: [],
    timelineMemo: '',
  }
}

function readStoredDocument(timelineId) {
  try {
    if (!timelineId) return null

    const rawValue = window.localStorage.getItem(`${STORAGE_DOC_PREFIX}${timelineId}`)
    if (!rawValue) return null

    const parsedValue = JSON.parse(rawValue)
    return normalizeDocument(parsedValue)
  } catch {
    return null
  }
}

function writeStoredDocument(timelineId, characters, timelineMemo) {
  try {
    window.localStorage.setItem(
      `${STORAGE_DOC_PREFIX}${timelineId}`,
      JSON.stringify({
        version: STORAGE_VERSION,
        updatedAt: new Date().toISOString(),
        characters,
        timelineMemo,
      }),
    )
  } catch {
    // 保存できない環境では、URL出力だけで使えるようにします。
  }
}

function removeStoredCharacters(timelineId) {
  try {
    window.localStorage.removeItem(`${STORAGE_DOC_PREFIX}${timelineId}`)
  } catch {
    // localStorageが使えない環境では何もしません。
  }
}

function readHashState() {
  try {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const data = params.get(URL_DATA_KEY)

    return {
      isExportMode: params.get('export') === '1',
      isBlankMode: params.get(URL_BLANK_KEY) === '1',
      timelineId: params.get(URL_TIMELINE_ID_KEY),
      document: data ? normalizeDocument(JSON.parse(data)) : null,
    }
  } catch {
    return { isExportMode: false, isBlankMode: false, timelineId: null, document: null }
  }
}

function getActionLayouts(actions) {
  const laneEnds = []

  return [...actions]
    .sort((a, b) => toMinutes(a.start) - toMinutes(b.start) || a.id - b.id)
    .map((action) => {
      const startMinute = toMinutes(action.start)
      const endMinute = getActionEndMinute(action)
      let lane = laneEnds.findIndex((laneEnd) => startMinute >= laneEnd)

      if (lane === -1) {
        lane = laneEnds.length
        laneEnds.push(endMinute)
      } else {
        laneEnds[lane] = endMinute
      }

      return { ...action, startMinute, endMinute, lane }
    })
}

function getTimelineRows(characters) {
  return characters.map((character) => {
    const actionLayouts = getActionLayouts(character.actions)
    const laneCount =
      actionLayouts.length === 0 ? 1 : Math.max(...actionLayouts.map((action) => action.lane + 1))

    return {
      character,
      actionLayouts,
      laneCount,
      rowHeight: 52 + (laneCount - 1) * BAR_LANE_HEIGHT,
    }
  })
}

function drawRoundRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + width - r, y)
  ctx.quadraticCurveTo(x + width, y, x + width, y + r)
  ctx.lineTo(x + width, y + height - r)
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height)
  ctx.lineTo(x + r, y + height)
  ctx.quadraticCurveTo(x, y + height, x, y + height - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

function wrapCanvasText(ctx, text, maxWidth) {
  const lines = []

  String(text)
    .split(/\r?\n/)
    .forEach((paragraph) => {
      if (!paragraph) {
        lines.push('')
        return
      }

      let line = ''

      Array.from(paragraph).forEach((char) => {
        const nextLine = line + char

        if (line && ctx.measureText(nextLine).width > maxWidth) {
          lines.push(line)
          line = char
          return
        }

        line = nextLine
      })

      lines.push(line)
    })

  return lines
}

function TimelineView({ rows, characters, timeline, ticks, timelineWidth, onActionClick }) {
  return (
    <section className="timeline-wrap" aria-label="タイムライン">
      <div className="timeline" style={{ width: timelineWidth + 96 }}>
        <div className="axis-row">
          <div className="row-name" />
          <div className="bar-area" style={{ width: timelineWidth }}>
            {ticks.map((tick) => (
              <span
                className="tick-label"
                key={tick}
                style={{ left: (tick - timeline.start) * PX_PER_MINUTE }}
              >
                {toTime(tick)}
              </span>
            ))}
          </div>
        </div>

        {characters.length === 0 && <p className="empty">キャラクターを追加してください。</p>}

        {rows.map(({ character, actionLayouts, rowHeight }) => (
          <div className="timeline-row" key={character.id} style={{ minHeight: rowHeight }}>
            <div className="row-name">
              <span
                className="row-color-dot"
                style={{ backgroundColor: character.color || ACTION_COLORS[0].value }}
              />
              <span className="row-name-text">{character.name || '未命名'}</span>
            </div>
            <div className="bar-area" style={{ width: timelineWidth }}>
              {ticks.map((tick) => (
                <span
                  className="grid-line"
                  key={tick}
                  style={{ left: (tick - timeline.start) * PX_PER_MINUTE }}
                />
              ))}
              {actionLayouts.map((action) => {
                const left = (action.startMinute - timeline.start) * PX_PER_MINUTE
                const width = Math.max(getActionDuration(action) * PX_PER_MINUTE, 28)
                const top = 12 + action.lane * BAR_LANE_HEIGHT
                const witnesses = getWitnesses(action.witnessIds, characters)
                const witnessNames = witnesses.map((witness) => witness.name).filter(Boolean)

                return (
                  <button
                    type="button"
                    className={witnesses.length > 0 ? 'bar bar-witnessed' : 'bar'}
                    key={action.id}
                    onClick={() => onActionClick?.(character, action)}
                    style={{
                      left,
                      top,
                      width,
                      backgroundColor: character.color || ACTION_COLORS[0].value,
                    }}
                    title={`${action.start} - ${action.end} / ${action.place}${
                      witnessNames.length > 0 ? ` / 目撃: ${witnessNames.join(', ')}` : ''
                    }`}
                  >
                    <span className="bar-label">{action.place}</span>
                    {witnesses.length > 0 && (
                      <span className="bar-witness-dots" aria-label="目撃者">
                        {witnesses.map((witness) => (
                          <span
                            className="bar-witness-dot"
                            key={witness.id}
                            style={{ backgroundColor: witness.color || ACTION_COLORS[0].value }}
                            title={witness.name || '未命名'}
                          />
                        ))}
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function ActionDetailModal({ selectedActionDetails, onClose }) {
  if (!selectedActionDetails) return null

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal detail-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="detail-title">{selectedActionDetails.action.place}</h2>
        <dl className="detail-list">
          <div>
            <dt>人物</dt>
            <dd>{selectedActionDetails.character.name || '未命名'}</dd>
          </div>
          <div>
            <dt>時間</dt>
            <dd>
              {selectedActionDetails.action.start} - {selectedActionDetails.action.end}
            </dd>
          </div>
          <div>
            <dt>場所</dt>
            <dd>{selectedActionDetails.action.place}</dd>
          </div>
          <div>
            <dt>メモ</dt>
            <dd>{selectedActionDetails.action.memo || 'なし'}</dd>
          </div>
          <div>
            <dt>目撃者</dt>
            <dd>
              {selectedActionDetails.witnesses.length > 0 ? (
                <span className="detail-witnesses">
                  {selectedActionDetails.witnesses.map((witness) => (
                    <span className="detail-witness" key={witness.id}>
                      <span
                        className="detail-witness-dot"
                        style={{ backgroundColor: witness.color || ACTION_COLORS[0].value }}
                      />
                      {witness.name || '未命名'}
                    </span>
                  ))}
                </span>
              ) : (
                'なし'
              )}
            </dd>
          </div>
        </dl>
        <div className="modal-actions single-action">
          <button className="secondary" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}

function TimelineMemoModal({ timelineMemo, onChange, onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal timeline-memo-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="timeline-memo-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="timeline-memo-title">タイムラインメモ</h2>
        <textarea
          className="timeline-memo-input"
          value={timelineMemo}
          onChange={(event) => onChange(normalizeTimelineMemo(event.target.value))}
          placeholder="このタイムライン全体のメモ"
          maxLength={MAX_TIMELINE_MEMO_LENGTH}
        />
        <p className="memo-count">
          {timelineMemo.length}/{MAX_TIMELINE_MEMO_LENGTH}
        </p>
        <div className="modal-actions single-action">
          <button className="secondary" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </div>
  )
}

function App() {
  const [hashState] = useState(readHashState)
  const [timelineId] = useState(() => hashState.timelineId || makeTimelineId())
  const [initialDocument] = useState(
    () =>
      hashState.document ||
      (hashState.isBlankMode ? makeBlankDocument() : readStoredDocument(timelineId)) ||
      makeInitialDocument(),
  )
  const [characters, setCharacters] = useState(() => initialDocument.characters)
  const [timelineMemo, setTimelineMemo] = useState(() => initialDocument.timelineMemo)
  const [isExportMode, setIsExportMode] = useState(hashState.isExportMode)
  const [newName, setNewName] = useState('')
  const [drafts, setDrafts] = useState({})
  const [pendingDelete, setPendingDelete] = useState(null)
  const [selectedActionInfo, setSelectedActionInfo] = useState(null)
  const [isTimelineMemoOpen, setIsTimelineMemoOpen] = useState(false)
  const [message, setMessage] = useState('')
  const hasAvailableColor = Boolean(getUnusedColor(getUsedCharacterColors(characters)))

  const timeline = useMemo(() => {
    const allActions = characters.flatMap((character) => character.actions)
    if (allActions.length === 0) {
      return { start: toMinutes('12:00'), end: toMinutes('15:00') }
    }

    const minStart = Math.min(...allActions.map((action) => toMinutes(action.start)))
    const maxEnd = Math.max(...allActions.map((action) => getActionEndMinute(action)))

    return {
      start: Math.floor(minStart / TICK_MINUTES) * TICK_MINUTES,
      end: Math.ceil(maxEnd / TICK_MINUTES) * TICK_MINUTES,
    }
  }, [characters])

  const timelineWidth = Math.max((timeline.end - timeline.start) * PX_PER_MINUTE, 360)
  const rows = useMemo(() => getTimelineRows(characters), [characters])
  const selectedActionDetails = useMemo(() => {
    if (!selectedActionInfo) return null

    const character = characters.find(
      (currentCharacter) => currentCharacter.id === selectedActionInfo.characterId,
    )
    const action = character?.actions.find(
      (currentAction) => currentAction.id === selectedActionInfo.actionId,
    )

    if (!character || !action) return null

    return {
      character,
      action,
      witnesses: getWitnesses(action.witnessIds, characters),
    }
  }, [characters, selectedActionInfo])

  const ticks = useMemo(() => {
    const list = []
    for (let minute = timeline.start; minute <= timeline.end; minute += TICK_MINUTES) {
      list.push(minute)
    }
    return list
  }, [timeline])

  const showMessage = (text) => {
    setMessage(text)
    window.setTimeout(() => setMessage(''), 3000)
  }

  const openActionDetails = (character, action) => {
    setSelectedActionInfo({ characterId: character.id, actionId: action.id })
  }

  const buildUrl = (exportMode = false, options = {}) => {
    const { includeData = true, id = timelineId, blank = false } = options
    const params = new URLSearchParams()
    params.set(URL_TIMELINE_ID_KEY, id)
    if (includeData) {
      params.set(
        URL_DATA_KEY,
        JSON.stringify({
          characters,
          timelineMemo,
        }),
      )
    }
    if (blank) params.set(URL_BLANK_KEY, '1')
    if (exportMode) params.set('export', '1')

    return `${window.location.origin}${window.location.pathname}#${params.toString()}`
  }

  useEffect(() => {
    if (isExportMode) return

    writeStoredDocument(timelineId, characters, timelineMemo)
  }, [characters, isExportMode, timelineId, timelineMemo])

  useEffect(() => {
    if (isExportMode) return

    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    if (
      params.get(URL_TIMELINE_ID_KEY) === timelineId &&
      !params.has(URL_DATA_KEY) &&
      !params.has(URL_BLANK_KEY)
    ) {
      return
    }

    window.history.replaceState(null, '', buildUrl(false, { includeData: false }))
  }, [isExportMode, timelineId])

  const shareUrl = async (exportMode = false) => {
    const url = buildUrl(exportMode)

    try {
      if (navigator.share) {
        await navigator.share({
          title: '行動タイムライン',
          url,
        })
        return
      }

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url)
        showMessage('共有URLをコピーしました。')
        return
      }
    } catch {
      // キャンセルや権限拒否時は下の手動コピーに落とします。
    }

    window.prompt('URLをコピーしてください', url)
  }

  const openExportPage = () => {
    const opened = window.open(buildUrl(true), '_blank')
    if (!opened) showMessage('新しいタブを開けませんでした。URL共有から開いてください。')
  }

  const openNewTimeline = () => {
    const newTimelineId = makeTimelineId()
    const opened = window.open(
      buildUrl(false, { includeData: false, id: newTimelineId, blank: true }),
      '_blank',
    )

    if (!opened) showMessage('新しいタブを開けませんでした。')
  }

  const openEditPage = () => {
    window.history.replaceState(null, '', buildUrl(false, { includeData: false }))
    setIsExportMode(false)
  }

  const createImageBlob = () => {
    const nameWidth = 118
    const rightPadding = 18
    const titleHeight = 44
    const axisHeight = 36
    const width = Math.ceil(nameWidth + timelineWidth + rightPadding)
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    const memoText = timelineMemo.trim()
    const memoLineHeight = 19
    ctx.font = '13px system-ui, sans-serif'
    const memoLines = memoText ? wrapCanvasText(ctx, memoText, width - 32) : []
    const memoHeight = memoLines.length > 0 ? 44 + memoLines.length * memoLineHeight : 0
    const height = Math.ceil(
      titleHeight +
        axisHeight +
        rows.reduce((total, row) => total + row.rowHeight, 0) +
        16 +
        memoHeight,
    )
    const scale = Math.min(window.devicePixelRatio || 1, 2)

    canvas.width = width * scale
    canvas.height = height * scale
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    ctx.scale(scale, scale)

    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.fillStyle = '#222222'
    ctx.font = '700 20px system-ui, sans-serif'
    ctx.fillText('行動タイムライン', 16, 28)
    ctx.fillStyle = '#666666'
    ctx.font = '12px system-ui, sans-serif'
    ctx.fillText(`${toTime(timeline.start)} - ${toTime(timeline.end)}`, nameWidth, 28)

    const axisY = titleHeight
    ctx.strokeStyle = '#eeeeee'
    ctx.beginPath()
    ctx.moveTo(0, axisY + axisHeight)
    ctx.lineTo(width, axisY + axisHeight)
    ctx.stroke()

    ticks.forEach((tick) => {
      const x = nameWidth + (tick - timeline.start) * PX_PER_MINUTE
      ctx.fillStyle = '#666666'
      ctx.textAlign = 'center'
      ctx.font = '12px system-ui, sans-serif'
      ctx.fillText(toTime(tick), x, axisY + 22)
    })

    let y = titleHeight + axisHeight
    rows.forEach(({ character, actionLayouts, rowHeight }) => {
      ctx.strokeStyle = '#eeeeee'
      ctx.beginPath()
      ctx.moveTo(0, y + rowHeight)
      ctx.lineTo(width, y + rowHeight)
      ctx.stroke()

      ctx.fillStyle = '#222222'
      ctx.textAlign = 'left'
      ctx.font = '700 13px system-ui, sans-serif'
      ctx.fillText(character.name || '未命名', 10, y + 31)

      ticks.forEach((tick) => {
        const x = nameWidth + (tick - timeline.start) * PX_PER_MINUTE
        ctx.strokeStyle = '#eeeeee'
        ctx.beginPath()
        ctx.moveTo(x, y)
        ctx.lineTo(x, y + rowHeight)
        ctx.stroke()
      })

      actionLayouts.forEach((action) => {
        const x = nameWidth + (action.startMinute - timeline.start) * PX_PER_MINUTE
        const barY = y + 12 + action.lane * BAR_LANE_HEIGHT
        const barWidth = Math.max(getActionDuration(action) * PX_PER_MINUTE, 28)
        const witnesses = getWitnesses(action.witnessIds, characters)

        ctx.fillStyle = character.color || ACTION_COLORS[0].value
        drawRoundRect(ctx, x, barY, barWidth, 28, 6)
        ctx.fill()

        if (witnesses.length > 0) {
          ctx.strokeStyle = '#222222'
          ctx.lineWidth = 3
          drawRoundRect(ctx, x + 1.5, barY + 1.5, barWidth - 3, 25, 5)
          ctx.stroke()
        }

        ctx.save()
        drawRoundRect(ctx, x, barY, barWidth, 28, 6)
        ctx.clip()
        ctx.fillStyle = '#ffffff'
        ctx.textAlign = 'left'
        ctx.font = '12px system-ui, sans-serif'
        ctx.fillText(action.place, x + 8, barY + 18)

        witnesses.slice(0, 6).forEach((witness, witnessIndex, visibleWitnesses) => {
          const dotRadius = 3.5
          const dotGap = 3
          const dotStep = dotRadius * 2 + dotGap
          const dotX =
            x + barWidth - 8 - (visibleWitnesses.length - witnessIndex - 1) * dotStep - dotRadius
          const dotY = barY + 14

          if (dotX < x + 14) return

          ctx.beginPath()
          ctx.arc(dotX, dotY, dotRadius, 0, Math.PI * 2)
          ctx.fillStyle = witness.color || ACTION_COLORS[0].value
          ctx.fill()
          ctx.strokeStyle = '#ffffff'
          ctx.lineWidth = 1.5
          ctx.stroke()
        })
        ctx.restore()
      })

      y += rowHeight
    })

    if (memoLines.length > 0) {
      const memoY = y + 22

      ctx.fillStyle = '#222222'
      ctx.textAlign = 'left'
      ctx.font = '700 14px system-ui, sans-serif'
      ctx.fillText('メモ', 16, memoY)

      ctx.fillStyle = '#444444'
      ctx.font = '13px system-ui, sans-serif'
      memoLines.forEach((line, lineIndex) => {
        ctx.fillText(line, 16, memoY + 22 + lineIndex * memoLineHeight)
      })
    }

    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob)
        else reject(new Error('画像を作成できませんでした。'))
      }, 'image/png')
    })
  }

  const saveImage = async () => {
    try {
      const blob = await createImageBlob()
      const file = new File([blob], 'timeline.png', { type: 'image/png' })

      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({
          title: '行動タイムライン',
          text: 'タイムライン画像です。',
          files: [file],
        })
        return
      }

      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = 'timeline.png'
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 60000)
      showMessage('画像の保存/ダウンロードを開始しました。')
    } catch {
      showMessage('画像保存に失敗しました。PDF保存を試してください。')
    }
  }

  const addCharacter = () => {
    const name = newName.trim()
    const color = getUnusedColor(getUsedCharacterColors(characters))

    if (!name || characters.length >= MAX_CHARACTERS || !color) return

    setCharacters([
      ...characters,
      {
        id: makeId(),
        name,
        color,
        actions: [],
      },
    ])
    setNewName('')
  }

  const updateCharacterName = (characterId, name) => {
    setCharacters(
      characters.map((character) =>
        character.id === characterId ? { ...character, name } : character,
      ),
    )
  }

  const updateCharacterColor = (characterId, color) => {
    const usedColors = getUsedCharacterColors(characters, characterId)

    if (!isColor(color) || usedColors.has(color)) {
      showMessage('他のキャラクターが使っている色は選べません。')
      return
    }

    setCharacters(
      characters.map((character) =>
        character.id === characterId ? { ...character, color } : character,
      ),
    )
  }

  const requestDeleteCharacter = (character) => {
    setPendingDelete({
      type: 'character',
      characterId: character.id,
      title: 'キャラクターを削除しますか？',
      message: `「${character.name || '未命名'}」と、その行動をすべて削除します。`,
    })
  }

  const deleteCharacter = () => {
    if (!pendingDelete) return
    const deletedCharacterId = pendingDelete.characterId

    setCharacters(
      characters
        .filter((character) => character.id !== deletedCharacterId)
        .map((character) => ({
          ...character,
          actions: character.actions.map((action) => ({
            ...action,
            witnessIds: (action.witnessIds || []).filter(
              (witnessId) => witnessId !== deletedCharacterId,
            ),
          })),
        })),
    )
    setDrafts((currentDrafts) => {
      const { [deletedCharacterId]: deletedDraft, ...remainingDrafts } = currentDrafts

      return Object.fromEntries(
        Object.entries(remainingDrafts).map(([characterId, draft]) => [
          characterId,
          {
            ...draft,
            witnessIds: (draft.witnessIds || []).filter(
              (witnessId) => witnessId !== deletedCharacterId,
            ),
          },
        ]),
      )
    })
    setPendingDelete(null)
    setSelectedActionInfo(null)
  }

  const updateDraft = (characterId, field, value) => {
    const currentDraft = {
      ...defaultDraft,
      ...drafts[characterId],
    }
    const nextDraft = {
      ...currentDraft,
      [field]: value,
    }

    if (field === 'start') {
      const startMinute = parseTime(value)
      const endMinute = parseTime(currentDraft.end)

      if (startMinute !== null && endMinute !== null && endMinute <= startMinute) {
        nextDraft.end = toTime(startMinute + DEFAULT_ACTION_MINUTES)
      }
    }

    setDrafts({
      ...drafts,
      [characterId]: nextDraft,
    })
  }

  const toggleDraftWitness = (characterId, witnessId) => {
    const currentDraft = {
      ...defaultDraft,
      ...drafts[characterId],
    }
    const witnessIds = currentDraft.witnessIds || []
    const nextWitnessIds = witnessIds.includes(witnessId)
      ? witnessIds.filter((currentWitnessId) => currentWitnessId !== witnessId)
      : [...witnessIds, witnessId]

    setDrafts({
      ...drafts,
      [characterId]: {
        ...currentDraft,
        witnessIds: nextWitnessIds,
      },
    })
  }

  const selectActionForEdit = (characterId, action) => {
    setDrafts({
      ...drafts,
      [characterId]: {
        start: action.start,
        end: action.end,
        place: action.place,
        memo: action.memo || '',
        witnessIds: [...(action.witnessIds || [])],
        editingActionId: action.id,
      },
    })
  }

  const cancelActionEdit = (characterId) => {
    setDrafts({
      ...drafts,
      [characterId]: { ...defaultDraft },
    })
  }

  const saveAction = (characterId) => {
    const draft = {
      ...defaultDraft,
      ...drafts[characterId],
    }
    const start = toStepTime(draft.start, defaultDraft.start)
    const end = toStepTime(draft.end, defaultDraft.end)
    const validCharacterIds = new Set(characters.map((character) => character.id))
    const witnessIds = normalizeWitnessIds(draft.witnessIds, validCharacterIds, characterId)
    const place = String(draft.place || '').trim() || '場所未設定'
    const memo = String(draft.memo || '').trim()

    if (start === end) {
      showMessage('開始時刻と終了時刻を別にしてください。')
      return
    }

    if (draft.editingActionId) {
      setCharacters(
        characters.map((character) =>
          character.id === characterId
            ? {
                ...character,
                actions: character.actions.map((action) =>
                  action.id === draft.editingActionId
                    ? {
                        ...action,
                        start,
                        end,
                        place,
                        memo,
                        witnessIds,
                      }
                    : action,
                ),
              }
            : character,
        ),
      )

      setDrafts({
        ...drafts,
        [characterId]: { ...defaultDraft, start, end },
      })
      return
    }

    setCharacters(
      characters.map((character) =>
        character.id === characterId
          ? {
              ...character,
              actions: [
                ...character.actions,
                {
                  id: makeId(),
                  start,
                  end,
                  place,
                  memo,
                  witnessIds,
                },
              ],
            }
          : character,
      ),
    )

    setDrafts({
      ...drafts,
      [characterId]: { ...defaultDraft, start, end },
    })
  }

  const requestResetTimeline = () => {
    setPendingDelete({
      type: 'reset',
      title: 'タイムラインをリセットしますか？',
      message: '現在の入力内容と保存内容を消して、初期状態に戻します。',
    })
  }

  const resetTimeline = () => {
    removeStoredCharacters(timelineId)
    setCharacters(cloneInitialCharacters())
    setTimelineMemo('')
    setDrafts({})
    setPendingDelete(null)
    setSelectedActionInfo(null)
    setIsTimelineMemoOpen(false)
    showMessage('タイムラインをリセットしました。')
  }

  const requestDeleteAction = (character, action) => {
    setPendingDelete({
      type: 'action',
      characterId: character.id,
      actionId: action.id,
      title: '行動を削除しますか？',
      message: `「${character.name || '未命名'}」の「${action.place}」を削除します。`,
    })
  }

  const deleteAction = () => {
    if (!pendingDelete) return
    const { characterId, actionId } = pendingDelete

    setCharacters(
      characters.map((character) =>
        character.id === characterId
          ? {
              ...character,
              actions: character.actions.filter((action) => action.id !== actionId),
            }
          : character,
      ),
    )
    setDrafts((currentDrafts) => {
      if (currentDrafts[characterId]?.editingActionId !== actionId) return currentDrafts

      return {
        ...currentDrafts,
        [characterId]: { ...defaultDraft },
      }
    })
    setPendingDelete(null)
    setSelectedActionInfo(null)
  }

  const confirmDelete = () => {
    if (pendingDelete?.type === 'character') deleteCharacter()
    if (pendingDelete?.type === 'action') deleteAction()
    if (pendingDelete?.type === 'reset') resetTimeline()
  }

  if (isExportMode) {
    return (
      <main className="app export-page">
        <header className="app-header">
          <div>
            <h1>行動タイムライン</h1>
            <p>この出力URLを共有すると、相手も表示や再編集ができます。</p>
          </div>
        </header>

        <section className="export-controls no-print">
          <button onClick={() => window.print()}>PDF/印刷</button>
          <button onClick={saveImage}>画像保存/共有</button>
          <button className="secondary" onClick={() => shareUrl(true)}>
            URL共有
          </button>
          <button className="secondary" onClick={openEditPage}>
            この内容を編集
          </button>
        </section>

        {message && <p className="notice no-print">{message}</p>}

        <TimelineView
          rows={rows}
          characters={characters}
          timeline={timeline}
          ticks={ticks}
          timelineWidth={timelineWidth}
          onActionClick={openActionDetails}
        />
        {timelineMemo.trim() && (
          <section className="export-memo">
            <h2>メモ</h2>
            <p>{timelineMemo}</p>
          </section>
        )}
        <ActionDetailModal
          selectedActionDetails={selectedActionDetails}
          onClose={() => setSelectedActionInfo(null)}
        />
      </main>
    )
  }

  return (
    <main className="app">
      <header className="app-header">
        <div>
          <h1>行動タイムライン</h1>
          <p>キャラクターごとの行動時間を横スクロールで確認できます。</p>
        </div>
        <div className="header-actions">
          <span>{characters.length}/{MAX_CHARACTERS}人</span>
          <button className="secondary" onClick={openNewTimeline}>
            新規
          </button>
          <button className="secondary" onClick={() => setIsTimelineMemoOpen(true)}>
            メモ
          </button>
          <button className="danger" onClick={requestResetTimeline}>
            リセット
          </button>
          <button onClick={openExportPage}>出力</button>
        </div>
      </header>

      {message && <p className="notice">{message}</p>}

      <TimelineView
        rows={rows}
        characters={characters}
        timeline={timeline}
        ticks={ticks}
        timelineWidth={timelineWidth}
        onActionClick={openActionDetails}
      />

      <section className="add-character">
        <input
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && addCharacter()}
          placeholder="キャラクター名"
          maxLength={20}
        />
        <button
          onClick={addCharacter}
          disabled={!newName.trim() || characters.length >= MAX_CHARACTERS || !hasAvailableColor}
        >
          追加
        </button>
      </section>

      <section className="editors">
        {characters.map((character) => {
          const draft = {
            ...defaultDraft,
            ...drafts[character.id],
          }
          const isEditingAction = Boolean(draft.editingActionId)
          const witnessChoices = characters.filter((candidate) => candidate.id !== character.id)
          const selectedWitnessIds = new Set(draft.witnessIds || [])

          return (
            <div className="editor" key={character.id}>
              <div className="name-line">
                <input
                  className="character-name-input"
                  value={character.name}
                  onChange={(event) => updateCharacterName(character.id, event.target.value)}
                  placeholder="名前"
                />
                <select
                  className="character-color-select"
                  value={character.color || ACTION_COLORS[0].value}
                  onChange={(event) => updateCharacterColor(character.id, event.target.value)}
                  aria-label="キャラクター色"
                >
                  {ACTION_COLORS.map((color) => {
                    const isUsedByOther = characters.some(
                      (otherCharacter) =>
                        otherCharacter.id !== character.id && otherCharacter.color === color.value,
                    )

                    return (
                      <option key={color.value} value={color.value} disabled={isUsedByOther}>
                        {color.label}
                      </option>
                    )
                  })}
                </select>
                <button className="danger" onClick={() => requestDeleteCharacter(character)}>
                  削除
                </button>
              </div>

              <div className="action-line">
                <input
                  className="time-input"
                  type="time"
                  step="300"
                  value={draft.start}
                  onChange={(event) => updateDraft(character.id, 'start', event.target.value)}
                  aria-label="開始時刻"
                />
                <input
                  className="time-input"
                  type="time"
                  step="300"
                  value={draft.end}
                  onChange={(event) => updateDraft(character.id, 'end', event.target.value)}
                  aria-label="終了時刻"
                />
                <input
                  className="place-input"
                  value={draft.place}
                  onChange={(event) => updateDraft(character.id, 'place', event.target.value)}
                  placeholder="場所"
                />
                <input
                  className="memo-input"
                  value={draft.memo}
                  onChange={(event) => updateDraft(character.id, 'memo', event.target.value)}
                  placeholder="メモ"
                />
                <button onClick={() => saveAction(character.id)}>
                  {isEditingAction ? '行動編集' : '行動追加'}
                </button>
                {isEditingAction && (
                  <button className="secondary" onClick={() => cancelActionEdit(character.id)}>
                    解除
                  </button>
                )}
              </div>

              {witnessChoices.length > 0 && (
                <div className="witness-line" aria-label="目撃者">
                  <span className="witness-label">目撃者</span>
                  {witnessChoices.map((witness) => {
                    const isSelected = selectedWitnessIds.has(witness.id)

                    return (
                      <button
                        className={isSelected ? 'witness-pill is-selected' : 'witness-pill'}
                        key={witness.id}
                        onClick={() => toggleDraftWitness(character.id, witness.id)}
                        style={
                          isSelected
                            ? {
                                backgroundColor: witness.color || ACTION_COLORS[0].value,
                                borderColor: witness.color || ACTION_COLORS[0].value,
                              }
                            : undefined
                        }
                      >
                        {witness.name || '未命名'}
                      </button>
                    )
                  })}
                </div>
              )}

              {character.actions.length > 0 && (
                <div className="action-list">
                  {character.actions.map((action) => {
                    const witnessNames = getWitnessNames(action.witnessIds, characters)

                    return (
                      <div
                        className={
                          witnessNames.length > 0
                            ? 'action-chip-group action-chip-witnessed'
                            : 'action-chip-group'
                        }
                        key={action.id}
                        style={{
                          backgroundColor: character.color || ACTION_COLORS[0].value,
                        }}
                      >
                        <button
                          className="action-chip"
                          onClick={() => selectActionForEdit(character.id, action)}
                          title="クリックで編集"
                        >
                          {action.start} - {action.end} / {action.place}
                        </button>
                        <button
                          className="action-delete"
                          onClick={() => requestDeleteAction(character, action)}
                          aria-label={`${action.place}を削除`}
                          title="削除"
                        >
                          ×
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </section>

      <ActionDetailModal
        selectedActionDetails={selectedActionDetails}
        onClose={() => setSelectedActionInfo(null)}
      />

      {isTimelineMemoOpen && (
        <TimelineMemoModal
          timelineMemo={timelineMemo}
          onChange={setTimelineMemo}
          onClose={() => setIsTimelineMemoOpen(false)}
        />
      )}

      {pendingDelete && (
        <div className="modal-backdrop" onClick={() => setPendingDelete(null)}>
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="delete-title">{pendingDelete.title}</h2>
            <p>{pendingDelete.message}</p>
            <div className="modal-actions">
              <button className="secondary" onClick={() => setPendingDelete(null)}>
                キャンセル
              </button>
              <button className="danger" onClick={confirmDelete}>
                {pendingDelete.type === 'reset' ? 'リセットする' : '削除する'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

export default App
