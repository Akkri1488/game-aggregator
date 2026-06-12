import { useState, useEffect, useMemo } from 'react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from 'recharts';

const PLATFORMS = ['all', 'Steam', 'Epic', 'GOG'];

// ───────────────────────── helpers ─────────────────────────
const fmt = (n) => {
  const v = Number(n);
  if (v === 0) return 'Бесплатно';
  return v.toLocaleString('ru-RU', { minimumFractionDigits: 0 }) + ' ₽';
};

const discountClass = (d) => {
  if (d >= 100) return 's100';
  if (d >= 75)  return 's75';
  if (d >= 50)  return 's50';
  return 's0';
};

async function api(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error('Ошибка сети: ' + res.status);
  return res.json();
}

// ───────────────────────── App ─────────────────────────
export default function App() {
  const [tab, setTab] = useState('catalog');
  const [games, setGames] = useState([]);
  const [multi, setMulti] = useState([]);
  const [deals, setDeals] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        const [g, m, d, s] = await Promise.all([
          api('/api/games'),
          api('/api/games/multiplatform'),
          api('/api/deals?limit=60'),
          api('/api/stats'),
        ]);
        if (!alive) return;
        setGames(g); setMulti(m); setDeals(d); setStats(s);
        setError(null);
      } catch (e) {
        if (alive) setError(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  return (
    <div className="app">
      <header className="masthead">
        <div className="brand">
          <h1>GamePrice<span className="dot">.</span></h1>
          <span className="tag">// агрегатор цен · Steam · Epic · GOG</span>
        </div>
        <nav className="tabs">
          <button className={`tab ${tab === 'catalog' ? 'active' : ''}`} onClick={() => setTab('catalog')}>
            Каталог<span className="count">{games.length}</span>
          </button>
          <button className={`tab ${tab === 'multi' ? 'active' : ''}`} onClick={() => setTab('multi')}>
            Где дешевле<span className="count">{multi.length}</span>
          </button>
          <button className={`tab ${tab === 'deals' ? 'active' : ''}`} onClick={() => setTab('deals')}>
            Скидки<span className="count">{deals.length}</span>
          </button>
        </nav>
      </header>

      {stats && <StatsStrip stats={stats} />}

      {loading && <Loading />}
      {error && <ErrorState msg={error} />}

      {!loading && !error && (
        <>
          {tab === 'catalog' && <Catalog games={games} onOpen={setSelected} />}
          {tab === 'multi'   && <Multiplatform items={multi} onOpen={setSelected} />}
          {tab === 'deals'   && <Deals deals={deals} onOpen={setSelected} />}
        </>
      )}

      {selected && <GameModal game={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

// ───────────────────────── Stats ─────────────────────────
function StatsStrip({ stats }) {
  const cards = [
    { num: stats.totalGames,  lbl: 'Игр в базе' },
    { num: stats.totalPrices, lbl: 'Записей цен' },
    { num: stats.platforms.length, lbl: 'Платформ' },
    { num: stats.onSale, lbl: 'Со скидкой' },
  ];
  return (
    <div className="stats">
      {cards.map((c, i) => (
        <div className="stat" key={i}>
          <CountUp target={c.num} />
          <div className="lbl">{c.lbl}</div>
        </div>
      ))}
    </div>
  );
}

// Анимированный счётчик
function CountUp({ target }) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    let raf;
    const start = performance.now();
    const dur = 700;
    const tick = (now) => {
      const p = Math.min((now - start) / dur, 1);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return <div className="num">{val.toLocaleString('ru-RU')}</div>;
}

// ───────────────────────── Catalog ─────────────────────────
function Catalog({ games, onOpen }) {
  const [q, setQ] = useState('');
  const [platform, setPlatform] = useState('all');
  const [sort, setSort] = useState('title');

  const filtered = useMemo(() => {
    let list = games.filter(g => g.prices && g.prices.length > 0);
    if (q.trim()) {
      const needle = q.toLowerCase();
      list = list.filter(g => g.title.toLowerCase().includes(needle));
    }
    if (platform !== 'all') {
      list = list.filter(g => g.prices.some(p => p.platform === platform));
    }
    list = [...list].sort((a, b) => {
      if (sort === 'title') return a.title.localeCompare(b.title);
      const minA = Math.min(...a.prices.map(p => Number(p.price)));
      const minB = Math.min(...b.prices.map(p => Number(p.price)));
      if (sort === 'price-asc')  return minA - minB;
      if (sort === 'price-desc') return minB - minA;
      return 0;
    });
    return list;
  }, [games, q, platform, sort]);

  return (
    <>
      <div className="controls">
        <div className="search">
          <span className="icon">⌕</span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Поиск по названию игры…"
          />
        </div>
        <div className="chips">
          {PLATFORMS.map(p => (
            <button
              key={p}
              data-p={p}
              className={`chip ${platform === p ? 'on' : ''}`}
              onClick={() => setPlatform(p)}
            >
              {p === 'all' ? 'Все' : p}
            </button>
          ))}
        </div>
        <select className="select" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="title">По алфавиту</option>
          <option value="price-asc">Цена ↑</option>
          <option value="price-desc">Цена ↓</option>
        </select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="grid">
          {filtered.map(g => <GameCard key={g.id} game={g} onOpen={onOpen} />)}
        </div>
      )}
    </>
  );
}

function GameCard({ game, onOpen }) {
  const prices = game.prices.map(p => ({ ...p, price: Number(p.price) }));
  const best = Math.min(...prices.map(p => p.price));
  const sorted = [...prices].sort((a, b) => a.price - b.price);

  return (
    <div className="card" onClick={() => onOpen(game)}>
      <div className="card-head">
        <div>
          <h3>{game.title}</h3>
          {game.genre && <div className="genre">{game.genre}</div>}
        </div>
        {prices.length >= 2 && <span className="best-flag">★ выгода</span>}
      </div>
      <div className="prices">
        {sorted.map((p, i) => (
          <div className={`price-row ${p.price === best ? 'best' : ''}`} key={i}>
            <span className="plat">
              <span className="badge" data-p={p.platform}></span>
              {p.platform}
            </span>
            <span className={`price-val ${p.price === 0 ? 'free' : p.price === best ? 'best' : ''}`}>
              {fmt(p.price)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ───────────────────────── Multiplatform ─────────────────────────
function Multiplatform({ items, onOpen }) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    if (!q.trim()) return items;
    const n = q.toLowerCase();
    return items.filter(g => g.title.toLowerCase().includes(n));
  }, [items, q]);

  return (
    <>
      <div className="controls">
        <div className="search">
          <span className="icon">⌕</span>
          <input value={q} onChange={(e) => setQ(e.target.value)}
                 placeholder="Игры на нескольких платформах…" />
        </div>
      </div>
      {filtered.length === 0 ? <EmptyState /> : (
        <div className="grid">
          {filtered.map(g => {
            const cheapestPrice = Math.min(...g.platforms.map(p => p.price));
            const sorted = [...g.platforms].sort((a, b) => a.price - b.price);
            // адаптируем под GameCard-форму
            const asGame = { id: g.id, title: g.title, genre: g.genre,
              prices: sorted.map(p => ({ platform: p.platform, price: p.price, url: p.url })) };
            return (
              <div className="card" key={g.id} onClick={() => onOpen(asGame)}>
                <div className="card-head">
                  <div>
                    <h3>{g.title}</h3>
                    {g.genre && <div className="genre">{g.genre}</div>}
                  </div>
                  <span className="best-flag">{g.platforms.length} площадки</span>
                </div>
                <div className="prices">
                  {sorted.map((p, i) => (
                    <div className={`price-row ${p.price === cheapestPrice ? 'best' : ''}`} key={i}>
                      <span className="plat">
                        <span className="badge" data-p={p.platform}></span>{p.platform}
                      </span>
                      <span className={`price-val ${p.price === 0 ? 'free' : p.price === cheapestPrice ? 'best' : ''}`}>
                        {fmt(p.price)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ───────────────────────── Deals ─────────────────────────
function Deals({ deals, onOpen }) {
  const [minDisc, setMinDisc] = useState(0);
  const filtered = useMemo(
    () => deals.filter(d => d.discount_percent >= minDisc),
    [deals, minDisc]
  );

  return (
    <>
      <div className="controls">
        <div className="chips">
          {[0, 25, 50, 75].map(v => (
            <button key={v} className={`chip ${minDisc === v ? 'on' : ''}`}
                    data-p="all" onClick={() => setMinDisc(v)}>
              от {v}%
            </button>
          ))}
        </div>
      </div>
      {filtered.length === 0 ? <EmptyState /> : (
        <div className="grid">
          {filtered.map(d => {
            const game = {
              id: d.game_id,
              title: d.game?.title ?? 'Без названия',
              genre: d.game?.genre,
              prices: [{ platform: d.platform, price: Number(d.price), url: d.url }]
            };
            return (
              <div className="card" key={d.id} onClick={() => onOpen(game)}>
                <div className="card-head">
                  <div>
                    <h3>{d.game?.title ?? 'Без названия'}</h3>
                    <div className="genre">
                      <span className="badge" data-p={d.platform}
                            style={{ display: 'inline-block', marginRight: 6 }}></span>
                      {d.platform}
                    </div>
                  </div>
                  <span className={`deal-discount ${discountClass(d.discount_percent)}`}>
                    −{d.discount_percent}%
                  </span>
                </div>
                <div className="price-row best">
                  <span className="plat">
                    <span className="price-was">{fmt(d.original_price)}</span>
                  </span>
                  <span className={`price-val ${Number(d.price) === 0 ? 'free' : 'best'}`}>
                    {fmt(d.price)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

// ───────────────────────── Modal ─────────────────────────
function GameModal({ game, onClose }) {
  const [history, setHistory] = useState(null);
  const [loadingH, setLoadingH] = useState(true);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoadingH(true);
        const h = await api(`/api/games/${game.id}/history`);
        if (alive) setHistory(h);
      } catch {
        if (alive) setHistory([]);
      } finally {
        if (alive) setLoadingH(false);
      }
    })();
    return () => { alive = false; };
  }, [game.id]);

  const chartData = (history ?? []).map(h => ({
    date: new Date(h.date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }),
    price: Number(h.price)
  }));

  const sorted = [...game.prices].sort((a, b) => Number(a.price) - Number(b.price));

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2>{game.title}</h2>
          </div>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        {game.genre && <div className="genre">{game.genre}</div>}

        <div className="modal-section-label">Цены по платформам</div>
        {sorted.map((p, i) => (
          <div className="buy-row" key={i}>
            <span className="plat">
              <span className="badge" data-p={p.platform}></span>
              {p.platform}
              <span className="price-val" style={{ marginLeft: 12 }}>{fmt(p.price)}</span>
            </span>
            {p.url && (
              <a className="buy-btn" href={p.url} target="_blank" rel="noreferrer">
                В магазин →
              </a>
            )}
          </div>
        ))}

        <div className="modal-section-label">История цены</div>
        {loadingH ? (
          <div className="state" style={{ padding: '30px' }}>
            <div className="spinner"></div>
          </div>
        ) : chartData.length < 2 ? (
          <div style={{ color: 'var(--text-faint)', fontSize: 13, fontFamily: 'var(--mono)' }}>
            Недостаточно точек для графика — история накапливается при повторных запусках парсера.
          </div>
        ) : (
          <div className="chart-box">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 10, bottom: 0, left: -16 }}>
                <CartesianGrid stroke="#2a3050" strokeDasharray="3 3" />
                <XAxis dataKey="date" stroke="#5d6488" fontSize={11} />
                <YAxis stroke="#5d6488" fontSize={11} />
                <Tooltip
                  contentStyle={{
                    background: '#151829', border: '1px solid #3a4270',
                    borderRadius: 10, fontFamily: 'monospace', fontSize: 12
                  }}
                  labelStyle={{ color: '#9aa0bf' }}
                  formatter={(v) => [fmt(v), 'Цена']}
                />
                <Line type="monotone" dataKey="price" stroke="#7c5cff" strokeWidth={2}
                      dot={{ fill: '#9d83ff', r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  );
}

// ───────────────────────── States ─────────────────────────
function Loading() {
  return (
    <div className="state">
      <div className="spinner"></div>
      <div>Загружаем данные из агрегатора…</div>
    </div>
  );
}

function ErrorState({ msg }) {
  return (
    <div className="state">
      <div className="big">Не удалось получить данные</div>
      <div>{msg}</div>
      <div style={{ marginTop: 12, fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--text-faint)' }}>
        Проверь, что бэкенд запущен (node index.js) на порту 5001.
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="state">
      <div className="big">Ничего не найдено</div>
      <div>Попробуй изменить поиск или фильтры.</div>
    </div>
  );
}
