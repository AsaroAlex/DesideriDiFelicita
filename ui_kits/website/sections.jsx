/* Desideri di Felicità — website UI kit sections.
   Composes the design-system components (window.DesideriDiFelicitDesignSystem_dcc6e0)
   with site data (window.SITE). Exports sections to window. */
const DS = window.DesideriDiFelicitDesignSystem_dcc6e0;
const { Button, Logo, Eyebrow, Badge, SectionHeading, Icon, WhatsappButton,
        ServiceCard, TestimonialCard, FaqItem, GalleryFigure, StarRating } = DS;
const S = window.SITE;
const { useState } = React;

/* ---------- Header ---------- */
function Header({ page, setPage, scrolled }) {
  const [open, setOpen] = useState(false);
  const nav = [
    ['home', 'Home'], ['servizi', 'Servizi'], ['galleria', 'Galleria'],
    ['chi-siamo', 'Chi siamo'], ['contatti', 'Contatti'],
  ];
  const go = (p) => { setPage(p); setOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  return (
    <header className={'site-header' + (scrolled ? ' is-scrolled' : '')}>
      <div className="kit-container site-header__inner">
        <a className="brand" onClick={() => go('home')} href="#"><Logo /></a>
        <button className="nav-toggle" aria-expanded={open} aria-label={open ? 'Chiudi il menu' : 'Apri il menu'} onClick={() => setOpen(o => !o)}>
          <span /><span /><span />
        </button>
        <nav className={'site-nav' + (open ? ' is-open' : '')}>
          <ul>
            {nav.map(([id, label]) => (
              <li key={id}>
                <a href="#" className={page === id ? 'is-active' : ''} aria-current={page === id ? 'page' : undefined} onClick={(e) => { e.preventDefault(); go(id); }}>{label}</a>
              </li>
            ))}
          </ul>
          <WhatsappButton label="WhatsApp" />
        </nav>
      </div>
    </header>
  );
}

/* ---------- Hero ---------- */
function Hero({ setPage }) {
  return (
    <section className="hero">
      <span className="hero__glow hero__glow--gold" aria-hidden="true" />
      <span className="hero__glow hero__glow--blue" aria-hidden="true" />
      <div className="kit-container hero__inner">
        <div className="hero__content reveal">
          <Eyebrow>{S.role} · Galliera (BO)</Eyebrow>
          <h1 className="hero__title">La bellezza nasce da un <em>desiderio</em>, la felicità lo rende <em>reale</em>.</h1>
          <p className="lead hero__desc">{S.tagline} Salone di parrucchiera a Galliera (BO): taglio, colore, balayage e cura del riccio, su misura per te.</p>
          <div className="hero__actions">
            <WhatsappButton label="Prenota su WhatsApp" />
            <Button variant="outline" icon={<Icon name="phone" />} href={'tel:' + S.phone.replace(/\s/g, '')}>Chiama ora</Button>
          </div>
        </div>
        <div className="hero__media reveal">
          <img className="hero__img" src={S.heroImg} alt={'Risultato di colore e piega — ' + S.businessName} />
        </div>
      </div>
    </section>
  );
}

/* ---------- Services ---------- */
function Services({ compact }) {
  const list = compact ? S.services.slice(0, 6) : S.services;
  return (
    <section className="section">
      <div className="kit-container reveal">
        <SectionHeading align="center" eyebrow="I nostri servizi"
          title={<>Ogni look nasce dall’<em>ascolto</em>.</>}
          lead="Taglio donna, uomo e bambino, colore, balayage e la cura del capello riccio — la nostra specialità."
          style={{ marginInline: 'auto', marginBottom: 'var(--space-2xl)' }} />
        <div className="grid-3">
          {list.map((s, i) => <ServiceCard key={s.name} index={i + 1} name={s.name} description={s.description} />)}
        </div>
      </div>
    </section>
  );
}

/* ---------- Values (dark) ---------- */
function Values() {
  return (
    <section className="section section--dark">
      <div className="kit-container reveal">
        <SectionHeading onDark eyebrow="Il nostro approccio"
          title={<>Cura, ascolto e capelli <em>sani</em>.</>}
          lead="Quattro principi che guidano ogni appuntamento da Desideri di Felicità."
          style={{ marginBottom: 'var(--space-2xl)' }} />
        <div className="grid-4">
          {S.values.map((v, i) => (
            <div key={v.t} className="value">
              <span className="value__num">{String(i + 1).padStart(2, '0')}</span>
              <h3 className="value__t">{v.t}</h3>
              <p className="value__d">{v.d}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- Gallery ---------- */
function Gallery({ compact }) {
  const list = compact ? S.gallery.slice(0, 6) : S.gallery;
  return (
    <section className="section section--alt">
      <div className="kit-container reveal">
        <SectionHeading eyebrow="Galleria"
          title={<>I nostri <em>lavori</em>.</>}
          lead="Una selezione di tagli, colori e acconciature realizzati in salone."
          style={{ marginBottom: 'var(--space-2xl)' }} />
        <div className="grid-gallery">
          {list.map((g) => (
            <GalleryFigure key={g.src} src={S.imgBase + g.src} alt={g.alt} category={g.cat} caption={g.alt} />
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- Testimonials ---------- */
function Testimonials() {
  const r = S.googleReviews;
  return (
    <section className="section">
      <div className="kit-container reveal">
        <SectionHeading align="center" eyebrow="Dicono di noi"
          title={<>Le parole delle nostre <em>clienti</em>.</>}
          style={{ marginInline: 'auto', marginBottom: 'var(--space-lg)' }} />
        <p className="rating-line">
          <StarRating rating={r.rating} size="1.3em" />
          <span>{r.rating.toLocaleString('it-IT')} su 5 · {r.count} recensioni su Google</span>
        </p>
        <div className="grid-3">
          {S.reviews.map((rv) => <TestimonialCard key={rv.author} rating={rv.rating} author={rv.author} text={rv.text} />)}
        </div>
        <p style={{ textAlign: 'center', marginTop: 'var(--space-xl)' }}>
          <Button variant="outline">Tutte le recensioni su Google</Button>
        </p>
      </div>
    </section>
  );
}

/* ---------- FAQ ---------- */
function Faq() {
  const [open, setOpen] = useState(0);
  return (
    <section className="section section--blush">
      <div className="kit-container kit-container--narrow reveal">
        <SectionHeading align="center" eyebrow="Domande frequenti"
          title="Tutto quello che vuoi sapere."
          style={{ marginInline: 'auto', marginBottom: 'var(--space-xl)' }} />
        <div style={{ display: 'grid', gap: 'var(--space-sm)' }}>
          {S.faqs.map((f, i) => (
            <FaqItem key={f.q} q={f.q} a={f.a} open={open === i} onToggle={() => setOpen(open === i ? -1 : i)} />
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- About / Chi siamo ---------- */
function About() {
  return (
    <section className="section">
      <div className="kit-container about">
        <div className="about__media reveal">
          <img src={S.jessicaImg} alt={S.ownerName + ', hair stylist'} />
        </div>
        <div className="about__body reveal">
          <Eyebrow>Chi siamo</Eyebrow>
          <h2 className="about__title">Ciao, sono <em>Jessica</em>.</h2>
          <p className="lead">Da Desideri di Felicità ogni look nasce dall’ascolto del tuo desiderio. Amo i capelli ricci e la loro natura: per me ogni piega è un piccolo momento di felicità da creare insieme.</p>
          <p style={{ color: 'var(--color-ink-soft)' }}>Il salone si trova a Galliera (BO), uno spazio caldo e accogliente dove prenderti cura di te con prodotti professionali e tagli su misura.</p>
          <div style={{ marginTop: 'var(--space-lg)' }}>
            <WhatsappButton label="Prenota con Jessica" />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- Contatti ---------- */
function Contatti() {
  return (
    <section className="section">
      <div className="kit-container contatti">
        <div className="reveal">
          <Eyebrow>Contatti</Eyebrow>
          <h2 className="about__title">Passa a <em>trovarci</em>.</h2>
          <ul className="contact-list">
            <li><Icon name="mapPin" /><span>{S.address.street}<br />{S.address.postalCode} {S.address.city} ({S.address.province})</span></li>
            <li><Icon name="phone" /><a href={'tel:' + S.phone.replace(/\s/g, '')}>{S.phone}</a></li>
            <li><Icon name="instagram" /><a href={S.instagramUrl} target="_blank" rel="noopener">@desideri.di.felicita</a></li>
          </ul>
          <div className="hours">
            <h3>Orari <Badge variant="tbc">da confermare</Badge></h3>
            <table>
              <tbody>
                {S.openingHours.map((o) => (
                  <tr key={o.label}><th>{o.label}</th><td>{o.txt}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: 'var(--space-lg)', display: 'flex', gap: 'var(--space-md)', flexWrap: 'wrap' }}>
            <WhatsappButton label="Scrivici su WhatsApp" />
            <Button variant="outline" icon={<Icon name="phone" />} href={'tel:' + S.phone.replace(/\s/g, '')}>Chiama</Button>
          </div>
        </div>
        <div className="map reveal" aria-hidden="true">
          <img src={S.salonImg} alt="" />
          <span className="map__pin"><Icon name="mapPin" size="1.4rem" /> Galliera (BO)</span>
        </div>
      </div>
    </section>
  );
}

/* ---------- Footer ---------- */
function Footer({ setPage }) {
  const go = (p) => { setPage(p); window.scrollTo({ top: 0 }); };
  return (
    <footer className="site-footer">
      <div className="kit-container footer__grid">
        <div className="footer__brand">
          <Logo theme="dark" tagline={false} />
          <p className="footer__motto">{S.slogan}</p>
          <p className="footer__note">di {S.ownerName} · {S.role}</p>
        </div>
        <div>
          <h4>Dove siamo</h4>
          <p className="footer__note">{S.address.street}<br />{S.address.postalCode} {S.address.city} ({S.address.province})</p>
        </div>
        <div>
          <h4>Contatti</h4>
          <ul className="footer__list">
            <li><a href={'tel:' + S.phone.replace(/\s/g, '')}>{S.phone}</a></li>
            <li><a href={'mailto:' + S.email}>{S.email}</a></li>
            <li><a href={S.instagramUrl} target="_blank" rel="noopener">Instagram</a></li>
          </ul>
        </div>
        <div>
          <h4>Pagine</h4>
          <ul className="footer__list">
            <li><a href="#" onClick={(e) => { e.preventDefault(); go('servizi'); }}>Servizi</a></li>
            <li><a href="#" onClick={(e) => { e.preventDefault(); go('galleria'); }}>Galleria</a></li>
            <li><a href="#" onClick={(e) => { e.preventDefault(); go('contatti'); }}>Contatti</a></li>
          </ul>
        </div>
      </div>
      <div className="kit-container footer__bottom">
        <p className="footer__note">© {new Date().getFullYear()} {S.businessName}. P.IVA IT04315221202. Galliera (BO).</p>
        <p className="footer__note">Sito vetrina · Astro + TypeScript</p>
      </div>
    </footer>
  );
}

Object.assign(window, { Header, Hero, Services, Values, Gallery, Testimonials, Faq, About, Contatti, Footer });
