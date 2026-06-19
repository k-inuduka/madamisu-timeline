import { useMemo, useState } from 'react'

const MAX_CHARACTERS = 10
const PX_PER_MINUTE = 2
const TICK_MINUTES = 30
const BAR_LANE_HEIGHT = 34
const URL_DATA_KEY = 'data'

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
  duration: '30',
  memo: '',
  color: ACTION_COLORS[0].value,
}

const initialCharacters = [
  {
    id: 1,
    name: '探偵',
    actions: [{ id: 101, start: '20:00', duration: 50, memo: '食堂', color: ACTION_COLORS[0].value }],
  },
  {
    id: 2,
    name: '医者',
    actions: [{ id: 201, start: '20:30', duration: 70, memo: '書斎', color: ACTION_COLORS[1].value }],
  },
  {
    id: 3,
    name: '執事',
    actions: [{ id: 301, start: '20:00', duration: 35, memo: '庭', color: ACTION_COLORS[4].value }],
  },
]

function toMinutes(time) {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

function toTime(minutes) {
  const hours = Math.floor(minutes / 60) % 24
  const mins = minutes % 60
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
}

function makeId(index = 0) {
  return Date.now() + index + Math.floor(Math.random() * 1000)
}

function isColor(value) {
  return ACTION_COLORS.some((color) => color.value === value)
}

function normalizeCharacters(rawCharacters) {
  if (!Array.isArray(rawCharacters)) return null

  return rawCharacters.slice(0, MAX_CHARACTERS).map((character, characterIndex) => {
    const actions = Array.isArray(character.actions) ? character.actions : []

    return {
      id: Number(character.id) || makeId(characterIndex),
      name: String(character.name || '').slice(0, 20),
      actions: actions.map((action, actionIndex) => {
        const start = /^\d{2}:\d{2}$/.test(String(action.start)) ? action.start : '20:00'
        const duration = Math.max(1, Number(action.duration) || 30)

        return {
          id: Number(action.id) || makeId(actionIndex),
          start,
          duration,
          memo: String(action.memo || '行動').slice(0, 60),
          color: isColor(action.color) ? action.color : ACTION_COLORS[0].value,
        }
      }),
    }
  })
}

function readHashState() {
  try {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const data = params.get(URL_DATA_KEY)

    return {
      isExportMode: params.get('export') === '1',
      characters: data ? normalizeCharacters(JSON.parse(data)) : null,
    }
  } catch {
    return { isExportMode: false, characters: null }
  }
}

function getActionLayouts(actions) {
  const laneEnds = []

  return [...actions]
    .sort((a, b) => toMinutes(a.start) - toMinutes(b.start) || a.id - b.id)
    .map((action) => {
      const startMinute = toMinutes(action.start)
      const endMinute = startMinute + Number(action.duration)
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

function TimelineView({ rows, characters, timeline, ticks, timelineWidth }) {
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
            <div className="row-name">{character.name || '未命名'}</div>
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
                const width = Math.max(Number(action.duration) * PX_PER_MINUTE, 28)
                const top = 12 + action.lane * BAR_LANE_HEIGHT

                return (
                  <div
                    className="bar"
                    key={action.id}
                    style={{
                      left,
                      top,
                      width,
                      backgroundColor: action.color || ACTION_COLORS[0].value,
                    }}
                    title={`${action.start} / ${action.duration}分 / ${action.memo}`}
                  >
                    {action.memo}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function App() {
  const [hashState] = useState(readHashState)
  const [characters, setCharacters] = useState(hashState.characters || initialCharacters)
  const [isExportMode] = useState(hashState.isExportMode)
  const [newName, setNewName] = useState('')
  const [drafts, setDrafts] = useState({})
  const [pendingDelete, setPendingDelete] = useState(null)
  const [message, setMessage] = useState('')

  const timeline = useMemo(() => {
    const allActions = characters.flatMap((character) => character.actions)
    if (allActions.length === 0) {
      return { start: toMinutes('20:00'), end: toMinutes('23:00') }
    }

    const minStart = Math.min(...allActions.map((action) => toMinutes(action.start)))
    const maxEnd = Math.max(
      ...allActions.map((action) => toMinutes(action.start) + Number(action.duration)),
    )

    return {
      start: Math.floor(minStart / TICK_MINUTES) * TICK_MINUTES,
      end: Math.ceil(maxEnd / TICK_MINUTES) * TICK_MINUTES,
    }
  }, [characters])

  const timelineWidth = Math.max((timeline.end - timeline.start) * PX_PER_MINUTE, 360)
  const rows = useMemo(() => getTimelineRows(characters), [characters])

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

  const buildUrl = (exportMode = false) => {
    const params = new URLSearchParams()
    params.set(URL_DATA_KEY, JSON.stringify(characters))
    if (exportMode) params.set('export', '1')

    return `${window.location.origin}${window.location.pathname}#${params.toString()}`
  }

  const shareUrl = async (exportMode = false) => {
    const url = buildUrl(exportMode)

    try {
      if (navigator.share) {
        await navigator.share({
          title: '行動タイムライン',
          text: 'マーダーミステリー用の行動タイムラインです。',
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

  const openEditPage = () => {
    window.location.href = buildUrl(false)
  }

  const createImageBlob = () => {
    const nameWidth = 118
    const rightPadding = 18
    const titleHeight = 44
    const axisHeight = 36
    const width = Math.ceil(nameWidth + timelineWidth + rightPadding)
    const height = Math.ceil(
      titleHeight + axisHeight + rows.reduce((total, row) => total + row.rowHeight, 0) + 16,
    )
    const scale = Math.min(window.devicePixelRatio || 1, 2)
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')

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
        const barWidth = Math.max(Number(action.duration) * PX_PER_MINUTE, 28)

        ctx.fillStyle = action.color || ACTION_COLORS[0].value
        drawRoundRect(ctx, x, barY, barWidth, 28, 6)
        ctx.fill()

        ctx.save()
        drawRoundRect(ctx, x, barY, barWidth, 28, 6)
        ctx.clip()
        ctx.fillStyle = '#ffffff'
        ctx.textAlign = 'left'
        ctx.font = '12px system-ui, sans-serif'
        ctx.fillText(action.memo, x + 8, barY + 18)
        ctx.restore()
      })

      y += rowHeight
    })

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
    if (!name || characters.length >= MAX_CHARACTERS) return

    setCharacters([
      ...characters,
      {
        id: makeId(),
        name,
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

    setCharacters(characters.filter((character) => character.id !== pendingDelete.characterId))
    setPendingDelete(null)
  }

  const updateDraft = (characterId, field, value) => {
    setDrafts({
      ...drafts,
      [characterId]: {
        ...defaultDraft,
        ...drafts[characterId],
        [field]: value,
      },
    })
  }

  const addAction = (characterId) => {
    const draft = {
      ...defaultDraft,
      ...drafts[characterId],
    }
    const duration = Number(draft.duration)
    if (!draft.start || duration <= 0) return

    setCharacters(
      characters.map((character) =>
        character.id === characterId
          ? {
              ...character,
              actions: [
                ...character.actions,
                {
                  id: makeId(),
                  start: draft.start,
                  duration,
                  memo: draft.memo.trim() || '行動',
                  color: draft.color,
                },
              ],
            }
          : character,
      ),
    )

    setDrafts({
      ...drafts,
      [characterId]: { ...defaultDraft, start: draft.start, color: draft.color },
    })
  }

  const requestDeleteAction = (character, action) => {
    setPendingDelete({
      type: 'action',
      characterId: character.id,
      actionId: action.id,
      title: '行動を削除しますか？',
      message: `「${character.name || '未命名'}」の「${action.memo}」を削除します。`,
    })
  }

  const deleteAction = () => {
    if (!pendingDelete) return

    setCharacters(
      characters.map((character) =>
        character.id === pendingDelete.characterId
          ? {
              ...character,
              actions: character.actions.filter((action) => action.id !== pendingDelete.actionId),
            }
          : character,
      ),
    )
    setPendingDelete(null)
  }

  const confirmDelete = () => {
    if (pendingDelete?.type === 'character') deleteCharacter()
    if (pendingDelete?.type === 'action') deleteAction()
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
          <button onClick={openExportPage}>出力</button>
        </div>
      </header>

      {message && <p className="notice">{message}</p>}

      <section className="add-character">
        <input
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          onKeyDown={(event) => event.key === 'Enter' && addCharacter()}
          placeholder="キャラクター名"
          maxLength={20}
        />
        <button onClick={addCharacter} disabled={!newName.trim() || characters.length >= MAX_CHARACTERS}>
          追加
        </button>
      </section>

      <section className="editors">
        {characters.map((character) => {
          const draft = {
            ...defaultDraft,
            ...drafts[character.id],
          }

          return (
            <div className="editor" key={character.id}>
              <div className="name-line">
                <input
                  value={character.name}
                  onChange={(event) => updateCharacterName(character.id, event.target.value)}
                  placeholder="名前"
                />
                <button className="danger" onClick={() => requestDeleteCharacter(character)}>
                  削除
                </button>
              </div>

              <div className="action-line">
                <input
                  type="time"
                  value={draft.start}
                  onChange={(event) => updateDraft(character.id, 'start', event.target.value)}
                />
                <input
                  type="number"
                  min="1"
                  value={draft.duration}
                  onChange={(event) => updateDraft(character.id, 'duration', event.target.value)}
                  aria-label="所要時間（分）"
                />
                <input
                  value={draft.memo}
                  onChange={(event) => updateDraft(character.id, 'memo', event.target.value)}
                  placeholder="メモ"
                />
                <select
                  value={draft.color}
                  onChange={(event) => updateDraft(character.id, 'color', event.target.value)}
                  aria-label="バー色"
                >
                  {ACTION_COLORS.map((color) => (
                    <option key={color.value} value={color.value}>
                      {color.label}
                    </option>
                  ))}
                </select>
                <button onClick={() => addAction(character.id)}>行動追加</button>
              </div>

              {character.actions.length > 0 && (
                <div className="action-list">
                  {character.actions.map((action) => (
                    <button
                      className="action-chip"
                      key={action.id}
                      onClick={() => requestDeleteAction(character, action)}
                      style={{ backgroundColor: action.color || ACTION_COLORS[0].value }}
                      title="クリックで削除"
                    >
                      {action.start} / {action.duration}分 / {action.memo} ×
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </section>

      <TimelineView
        rows={rows}
        characters={characters}
        timeline={timeline}
        ticks={ticks}
        timelineWidth={timelineWidth}
      />

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
                削除する
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

export default App
