/**
 * dsh-aliyun-coupon —— Client 半部。
 * 在侧栏页脚（sidebar.footer.action，dsh-cost-meter 原来的位置）渲染一张卡券余额图框，
 * 数据只来自宿主进程的回环路由，浏览器不接触任何凭据。
 */
window.__ModuleLoader__.load({
  id: 'dsh-aliyun-coupon',
  factory(require) {
    const React = require('react')
    const { useState, useEffect, useRef, useCallback } = React
    const h = React.createElement

    const ROUTE = '/api/dsh-aliyun-coupon'
    const TEXT = {
      zh: {
        title: '阿里云代金券',
        generic: '代金券',
        used: '已用',
        face: '面值',
        expiry: '到期',
        expires: '有效期至',
        refresh: '点击刷新',
        refreshing: '正在刷新…',
        unconfigured: '未配置 AccessKey',
        writeTo: '把只读 RAM AccessKey 写进',
      },
      en: {
        title: 'Alibaba Cloud coupon',
        generic: 'coupon',
        used: 'used',
        face: 'face value',
        expiry: 'expires',
        expires: 'valid until',
        refresh: 'click to refresh',
        refreshing: 'refreshing…',
        unconfigured: 'no AccessKey configured',
        writeTo: 'write a read-only RAM AccessKey to',
      },
    }
    const text = (() => {
      try {
        return /^zh/i.test(window.navigator.language || '') ? TEXT.zh : TEXT.en
      } catch {
        return TEXT.zh
      }
    })()

    const CSS = [
      '.ac-root{display:flex;flex:1 1 100%;order:-1;flex-direction:column;gap:5px;box-sizing:border-box;width:100%;min-width:0;max-width:100%;padding:8px 10px;border:1px solid var(--dsw-alias-border-secondary,rgba(127,127,127,.22));border-radius:10px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08));font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#5b6472);cursor:pointer;transition:background .15s ease}',
      '.ac-root:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.14))}',
      '.ac-root.rail{flex:0 0 auto;width:auto;padding:2px 4px;border:0;background:transparent;align-items:center}',
      '.ac-head{display:flex;align-items:baseline;gap:6px;min-width:0}',
      '.ac-title{flex:1;min-width:0;font-weight:600;color:var(--dsw-alias-label-primary,#1f2430);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.ac-value{flex:none;font-weight:600;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary,#1f2430)}',
      '.ac-bar{height:6px;border-radius:3px;background:var(--dsw-alias-interactive-bg-hover,rgba(127,127,127,.18));overflow:hidden}',
      '.ac-fill{height:100%;border-radius:3px;background:var(--dsw-alias-brand-primary,#4c6ef5);transition:width .3s ease}',
      '.ac-sub{display:flex;gap:8px;min-width:0;font-size:11px;color:var(--dsw-alias-label-tertiary,#8a93a3);white-space:nowrap;overflow:hidden}',
      '.ac-grow{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis}',
      '.ac-warn{font-size:11px;color:var(--dsw-alias-state-warning-primary,#b45309);white-space:normal;word-break:break-word}',
      '[data-slot="sidebar.footer.action"]:has(>.ac-root){flex-wrap:wrap;align-items:stretch}',
      '[data-slot="sidebar.footer.action"]:has(>.ac-root.rail){flex-direction:column;align-items:center;justify-content:flex-start}',
    ].join('')

    const SYMBOLS = { CNY: '¥', USD: '$', EUR: '€' }

    function money(amount, currency, digits) {
      if (typeof amount !== 'number' || !Number.isFinite(amount)) return '—'
      const symbol = SYMBOLS[currency] ?? ''
      const shown = amount.toFixed(digits ?? 2)
      return currency && currency !== 'CNY' ? `${symbol}${shown}` : `¥${shown}`
    }

    function day(iso) {
      const stamp = Date.parse(iso ?? '')
      if (!Number.isFinite(stamp)) return ''
      try {
        return new Date(stamp).toLocaleDateString()
      } catch {
        return new Date(stamp).toISOString().slice(0, 10)
      }
    }

    function useSnapshot() {
      const [state, setState] = useState({ loading: true, payload: null, failure: '' })
      const busy = useRef(false)
      const load = useCallback(async refresh => {
        if (busy.current) return
        busy.current = true
        try {
          const response = await fetch(`${ROUTE}/${refresh ? 'refresh' : 'overview'}`, refresh ? { method: 'POST' } : undefined)
          const payload = await response.json()
          setState(previous => ({ loading: false, payload, failure: previous.failure && payload.ok ? '' : previous.failure }))
        } catch (error) {
          setState(previous => ({ ...previous, loading: false, failure: `${error?.message ?? error}` }))
        } finally {
          busy.current = false
        }
      }, [])
      useEffect(() => {
        void load(false)
        const timer = setInterval(() => {
          if (!document.hidden) void load(false)
        }, 60_000)
        return () => clearInterval(timer)
      }, [load])
      return [state, load]
    }

    function tooltip(payload) {
      const lines = []
      const coupon = payload?.coupon
      if (coupon) {
        lines.push(`${coupon.label || text.title}  ${money(coupon.remaining, coupon.currency)}`)
        lines.push(`${text.face} ${money(coupon.nominal, coupon.currency)}${coupon.used === null ? '' : ` · ${text.used} ${money(coupon.used, coupon.currency)}`}`)
        if (coupon.expiry) lines.push(`${text.expires} ${day(coupon.expiry)}`)
      }
      for (const item of payload?.coupons ?? []) {
        lines.push(`${item.no || '—'} · ${item.type || text.generic} · ${money(item.remaining, item.currency)}${item.expiry ? ` · ${day(item.expiry)}` : ''}`)
      }
      if (payload?.error) lines.push(payload.error)
      else if (payload?.hint) lines.push(payload.hint)
      else lines.push(`${text.refresh}${payload?.at ? ` · ${new Date(payload.at).toLocaleTimeString()}` : ''}`)
      return lines.join('\n')
    }

    function Card(props) {
      const wide = props?.wide !== false
      const [state, load] = useSnapshot()
      const payload = state.payload
      const coupon = payload?.coupon ?? null
      const ratio = coupon && coupon.nominal ? Math.min(100, Math.max(0, ((coupon.used ?? 0) / coupon.nominal) * 100)) : 0
      const headline = coupon ? money(coupon.remaining, coupon.currency, wide ? 2 : 1) : '—'
      const activate = event => {
        if (event?.key && event.key !== 'Enter' && event.key !== ' ') return
        event?.preventDefault?.()
        event?.stopPropagation?.()
        void load(true)
      }

      const style = h('style', { key: 'ac-style' }, CSS)

      if (!wide) {
        return h(
          'div',
          {
            className: 'ac-root rail cm-num',
            role: 'button',
            tabIndex: 0,
            title: tooltip(payload),
            'aria-label': `${text.title} ${headline}`,
            onClick: activate,
            onKeyDown: activate,
          },
          style,
          h('span', { className: 'ac-value' }, headline),
        )
      }

      const children = [
        style,
        h(
          'div',
          { className: 'ac-head', key: 'head' },
          h('span', { className: 'ac-title' }, coupon?.label || text.title),
          h('span', { className: 'ac-value' }, headline),
        ),
        h('div', { className: 'ac-bar', key: 'bar' }, h('div', { className: 'ac-fill', style: { width: `${ratio}%` } })),
      ]

      if (coupon) {
        children.push(
          h(
            'div',
            { className: 'ac-sub', key: 'sub' },
            h('span', { className: 'ac-grow' }, `${text.face} ${money(coupon.nominal, coupon.currency)} · ${text.used} ${money(coupon.used, coupon.currency)}`),
            h('span', null, coupon.count > 1 ? `${coupon.count}` : ''),
          ),
        )
        children.push(
          h(
            'div',
            { className: 'ac-sub', key: 'sub2' },
            h('span', { className: 'ac-grow' }, coupon.expiry ? `${text.expiry} ${day(coupon.expiry)}` : `${coupon.source}`),
            h('span', null, state.loading || payload?.busy ? text.refreshing : text.refresh),
          ),
        )
      }

      if (payload?.error) children.push(h('div', { className: 'ac-warn', key: 'error' }, payload.error))
      else if (payload && payload.configured === false) {
        children.push(
          h('div', { className: 'ac-sub', key: 'hint' }, h('span', { className: 'ac-grow' }, payload.hint || text.unconfigured)),
          h('div', { className: 'ac-warn', key: 'hint2' }, `${text.writeTo} ${payload.akFile}`),
        )
      } else if (!payload && state.failure) {
        children.push(h('div', { className: 'ac-warn', key: 'failure' }, state.failure))
      } else if (!payload) {
        children.push(h('div', { className: 'ac-sub', key: 'loading' }, h('span', { className: 'ac-grow' }, text.refreshing)))
      }

      return h(
        'div',
        {
          className: 'ac-root',
          role: 'button',
          tabIndex: 0,
          title: tooltip(payload),
          'aria-label': `${text.title} ${headline}`,
          onClick: activate,
          onKeyDown: activate,
        },
        children,
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('sidebar.footer.action', () =>
          ctx.slots.register({ name: 'sidebar.footer.action', id: 'aliyun-coupon', order: -1 }, Card),
        )
      },
    }
  },
})