'use client';

import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  Mountain,
  ShieldCheck,
  Timer,
} from 'lucide-react';
import { useEffect, useState } from 'react';

const packages = [
  {
    km: '05',
    name: '5 KM',
    price: '₹800',
    items: ['Finisher medal', 'Runner badge'],
    desc: 'Your first finish line.',
  },
  {
    km: '10',
    name: '10 KM',
    price: '₹1,200',
    items: ['Finisher medal', 'Runner badge', 'Refreshment pack'],
    desc: 'Find your next pace.',
  },
  {
    km: '20',
    name: '20 KM',
    price: '₹1,500',
    items: ['Finisher medal', 'Runner badge', 'Event T-shirt'],
    desc: 'Go further, feel stronger.',
  },
];

const goodies = [
  {
    image: '/images/medal-5km.jpg',
    title: '5 KM Finisher Medal',
    category: 'FINISHER MEDAL',
    description: 'Your first milestone. A medal to remember it.',
  },
  {
    image: '/images/medal-10km.jpg',
    title: '10 KM Finisher Medal',
    category: 'FINISHER MEDAL',
    description: 'A new distance. A new reason to feel proud.',
  },
  {
    image: '/images/medal-20km.jpg',
    title: '20 KM Finisher Medal',
    category: 'FINISHER MEDAL',
    description: 'For the miles that push you further.',
  },
  {
    image: '/images/badge-5km.jpg',
    title: '5 KM Runner Badge',
    category: 'RUNNER BADGE',
    description: 'Wear your 5 KM achievement with pride.',
  },
  {
    image: '/images/badge-10km.jpg',
    title: '10 KM Runner Badge',
    category: 'RUNNER BADGE',
    description: 'A mark of the distance you conquered.',
  },
  {
    image: '/images/badge-20km.jpg',
    title: '20 KM Runner Badge',
    category: 'RUNNER BADGE',
    description: 'A badge for going the extra miles.',
  },
  {
    image: '/images/shirt-front.jpg',
    title: 'BATTLE MILES Event T-shirt',
    category: 'EVENT T-SHIRT · FRONT',
    description: 'The official BATTLE MILES running tee.',
  },
  {
    image: '/images/shirt-back.jpg',
    title: 'BATTLE MILES Event T-shirt',
    category: 'EVENT T-SHIRT · BACK',
    description: 'A look at the back of the event T-shirt.',
  },
  {
    image: '/images/shirt-detail.jpg',
    title: 'BATTLE MILES T-shirt Detail',
    category: 'EVENT T-SHIRT · DETAIL',
    description: 'A closer look at the BATTLE MILES mark.',
  },
];

const faqs = [
  [
    'Can I run on a treadmill?',
    'Yes. Tracked indoor or outdoor runs are accepted, subject to the event rules.',
  ],
  [
    'How is my run verified?',
    'Submit a screenshot from your running app. Our system extracts activity details and flags possible inconsistencies for human admin review.',
  ],
  [
    'When will I receive my kit?',
    'Your kit becomes eligible after your run is verified. Dispatch timing will be confirmed by the event team.',
  ],
  [
    'Can I run anywhere?',
    'Yes. This is a virtual event: complete your chosen distance from a location that is safe and suitable for running.',
  ],
];

export default function Home() {
  const [open, setOpen] = useState<number | null>(0);
  const [activeGoodie, setActiveGoodie] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setActiveGoodie((current) => (current + 1) % goodies.length);
    }, 3600);

    return () => window.clearInterval(interval);
  }, []);

  const showPrevious = () => {
    setActiveGoodie((current) => (current - 1 + goodies.length) % goodies.length);
  };

  const showNext = () => {
    setActiveGoodie((current) => (current + 1) % goodies.length);
  };

  const currentGoodie = goodies[activeGoodie];

  return (
    <main>
      <header className="absolute z-20 top-0 left-0 right-0 text-white">
        <div className="container flex items-center justify-between py-6">
          <a href="#" className="font-black tracking-tight text-lg leading-none">
            BATTLE<span className="text-[#D9F36A]">.</span>
            <br />
            <span className="text-[10px] tracking-[.28em]">MILES</span>
          </a>
          <nav className="hidden md:flex items-center gap-8">
            <a className="navlink" href="#races">Races</a>
            <a className="navlink" href="#kit">Your kit</a>
            <a className="navlink" href="#how">How it works</a>
            <a className="navlink" href="#faq">FAQ</a>
          </nav>
          <a href="/register" className="btn btn-lime">
            Register now <ArrowUpRight size={16} />
          </a>
        </div>
      </header>

      <section className="relative min-h-[690px] md:min-h-[760px] flex items-center text-white overflow-hidden bg-[#07152f]">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage:
              "linear-gradient(90deg,rgba(5,15,35,.91),rgba(5,15,35,.42)),url('https://images.unsplash.com/photo-1552674605-db6ffd4facb5?auto=format&fit=crop&w=2200&q=85')",
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#07152f] via-transparent to-black/25" />
        <div className="container relative z-10 pt-24">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7 }}
            className="max-w-[720px]"
          >
            <div className="eyebrow text-[#D9F36A] mb-7">
              Virtual run · Run from anywhere
            </div>
            <h1 className="text-[clamp(58px,10vw,112px)] leading-[.86] tracking-[-.075em] font-black">
              BATTLE
              <br />
              <span className="text-[#D9F36A]">MILES.</span>
            </h1>
            <p className="text-white/75 text-lg md:text-xl max-w-lg mt-8 leading-relaxed">
              Run strong. Go further. Build a healthy tomorrow. Choose your
              distance, run on your terms, and earn your finisher kit.
            </p>
            <div className="flex flex-wrap gap-3 mt-9">
              <a href="/register" className="btn btn-lime">
                Choose your distance <ArrowUpRight size={17} />
              </a>
              <a href="#how" className="btn border border-white/40 text-white">
                How it works
              </a>
            </div>
          </motion.div>

          <div className="grid grid-cols-3 gap-4 border-t border-white/25 mt-20 pt-5 max-w-3xl">
            <div>
              <p className="text-[#D9F36A] font-black text-2xl">05—20</p>
              <p className="text-xs text-white/65 mt-1">Kilometre options</p>
            </div>
            <div>
              <p className="text-[#D9F36A] font-black text-2xl">ANYWHERE</p>
              <p className="text-xs text-white/65 mt-1">Your route, your pace</p>
            </div>
            <div>
              <p className="text-[#D9F36A] font-black text-2xl">YOUR KIT</p>
              <p className="text-xs text-white/65 mt-1">After verification</p>
            </div>
          </div>
        </div>
        <div className="absolute right-8 bottom-10 hidden lg:block [writing-mode:vertical-rl] text-[10px] tracking-[.3em] text-white/55">
          MOVE WITH PURPOSE · KEEP GOING
        </div>
      </section>

      <section id="races" className="section">
        <div className="container">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-5 mb-10">
            <div>
              <p className="eyebrow text-[#71852B]">Find your distance</p>
              <h2 className="section-title">
                YOUR RUN.
                <br />
                YOUR MILESTONE.
              </h2>
            </div>
            <p className="muted max-w-sm text-sm leading-6">
              One registration fee. Pick the distance that challenges you.
              Complete your run during the official event window.
            </p>
          </div>

          <div className="grid md:grid-cols-3 gap-4">
            {packages.map((p, i) => (
              <motion.article
                whileHover={{ y: -6 }}
                key={p.km}
                className={`card p-7 ${
                  i === 1 ? '!bg-[#d9f36a] !border-[#d9f36a]' : ''
                }`}
              >
                <div className="flex justify-between items-start">
                  <span className="eyebrow opacity-60">DISTANCE 0{i + 1}</span>
                  <Mountain size={22} />
                </div>
                <div className="text-[76px] font-black tracking-[-.08em] leading-none mt-9">
                  {p.km}
                  <span className="text-xl tracking-normal ml-2">KM</span>
                </div>
                <p className="text-sm opacity-65 mt-3">{p.desc}</p>
                <div className="border-t border-black/10 mt-8 pt-6">
                  <p className="eyebrow opacity-60">REGISTRATION FEE</p>
                  <p className="text-4xl font-black mt-1">{p.price}</p>
                  <ul className="space-y-3 my-7">
                    {p.items.map((x) => (
                      <li key={x} className="flex gap-2 text-sm">
                        <Check size={16} />
                        {x}
                      </li>
                    ))}
                  </ul>
                  <a
                    href={`/register?distance=${p.km}`}
                    className={`btn w-full ${
                      i === 1 ? 'bg-[#101820] text-white' : 'btn-dark'
                    }`}
                  >
                    Register for {p.name} <ArrowUpRight size={16} />
                  </a>
                </div>
              </motion.article>
            ))}
          </div>
          <p className="text-xs muted mt-4">
            Finisher-kit tier is determined by the verified distance completed,
            according to event rules.
          </p>
        </div>
      </section>

      <section id="kit" className="battle-kit-section">
        <div className="container">
          <div className="kit-heading">
            <p className="eyebrow text-[#D9F36A]">The finish feels good</p>
            <h2 className="section-title text-white">
              EARN YOUR
              <br />
              BATTLE GEAR.
            </h2>
            <p className="text-white/55 text-sm max-w-xl leading-6">
              Every kilometre has a story. Take a look at the medals, runner
              badges and official BATTLE MILES T-shirt waiting at the finish.
            </p>
          </div>

          <div className="goodie-showcase">
            <div className="goodie-side-note">
              <span>01</span>
              <span>THE FINISHER COLLECTION</span>
            </div>

            <button
              type="button"
              className="goodie-arrow goodie-arrow-left"
              onClick={showPrevious}
              aria-label="Previous item"
            >
              <ArrowLeft size={20} />
            </button>

            <div className="goodie-stage" aria-live="polite">
              <AnimatePresence mode="wait">
                <motion.div
                  key={currentGoodie.image}
                  className="goodie-feature"
                  initial={{ opacity: 0, scale: 0.78, x: 36, rotateY: 12 }}
                  animate={{ opacity: 1, scale: 1, x: 0, rotateY: 0 }}
                  exit={{ opacity: 0, scale: 0.78, x: -36, rotateY: -12 }}
                  transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
                >
                  <div className="goodie-image-wrap">
                    <img
                      src={currentGoodie.image}
                      alt={currentGoodie.title}
                      className="goodie-image"
                    />
                  </div>
                  <div className="goodie-copy">
                    <p className="eyebrow text-[#D9F36A]">
                      {currentGoodie.category}
                    </p>
                    <h3>{currentGoodie.title}</h3>
                    <p>{currentGoodie.description}</p>
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>

            <button
              type="button"
              className="goodie-arrow goodie-arrow-right"
              onClick={showNext}
              aria-label="Next item"
            >
              <ArrowRight size={20} />
            </button>

            <div className="goodie-progress">
              <div className="goodie-count">
                <span>{String(activeGoodie + 1).padStart(2, '0')}</span>
                <span className="goodie-count-divider">/</span>
                <span>{String(goodies.length).padStart(2, '0')}</span>
              </div>
              <div className="goodie-dots" aria-label="Choose showcase item">
                {goodies.map((item, index) => (
                  <button
                    key={item.image}
                    type="button"
                    onClick={() => setActiveGoodie(index)}
                    className={index === activeGoodie ? 'active' : ''}
                    aria-label={`Show ${item.title}`}
                    aria-current={index === activeGoodie ? 'true' : undefined}
                  />
                ))}
              </div>
              <span className="goodie-auto-label">
                AUTO SHOWCASE <span className="goodie-pulse" />
              </span>
            </div>
          </div>

          <div className="kit-includes">
            <div>
              <ShieldCheck size={20} />
              <span>Finisher medal & runner badge</span>
            </div>
            <div>
              <Timer size={20} />
              <span>Refreshment pack with 10 KM tier</span>
            </div>
            <div>
              <Check size={20} />
              <span>Event T-shirt with 20 KM tier</span>
            </div>
          </div>
        </div>
      </section>

      <section id="how" className="section">
        <div className="container">
          <p className="eyebrow text-[#71852B]">Four simple steps</p>
          <h2 className="section-title">
            FROM SIGN-UP
            <br />
            TO FINISH LINE.
          </h2>
          <div className="grid md:grid-cols-4 gap-7 mt-12">
            {[
              [
                '01',
                'Register & pay',
                'Choose your distance and complete registration securely.',
              ],
              [
                '02',
                'Run anywhere',
                'Run outdoors or on a treadmill during the event window.',
              ],
              [
                '03',
                'Submit your run',
                'Upload an activity screenshot showing distance, time and date.',
              ],
              [
                '04',
                'Get your kit',
                'The event team reviews your submission and confirms eligibility.',
              ],
            ].map((x) => (
              <div
                key={x[0]}
                className="border-t-2 border-[#d9f36a] pt-5"
              >
                <p className="font-black text-4xl text-[#9bad48]">{x[0]}</p>
                <h3 className="font-bold text-lg mt-6">{x[1]}</h3>
                <p className="muted text-sm leading-6 mt-3">{x[2]}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#e9eee3] py-20">
        <div className="container grid md:grid-cols-2 gap-10 items-center">
          <div>
            <p className="eyebrow text-[#71852B]">Every step counts</p>
            <h2 className="section-title">
              THE ONLY
              <br />
              PACE IS YOURS.
            </h2>
            <p className="muted leading-7 max-w-md">
              No crowded start line. No one else's schedule. Just you, your
              chosen distance and the satisfaction of seeing it through.
            </p>
            <a href="/register" className="btn btn-dark mt-7">
              I'm ready to run <ArrowUpRight size={16} />
            </a>
          </div>
          <div
            className="rounded-[28px] overflow-hidden min-h-[350px] bg-cover bg-center"
            style={{
              backgroundImage:
                "url('https://images.unsplash.com/photo-1476480862126-209bfaa8edc8?auto=format&fit=crop&w=1200&q=85')",
            }}
          />
        </div>
      </section>

      <section id="faq" className="section">
        <div className="container max-w-3xl">
          <p className="eyebrow text-[#71852B]">Good to know</p>
          <h2 className="section-title">
            QUESTIONS?
            <br />
            WE'VE GOT YOU.
          </h2>
          <div className="mt-9">
            {faqs.map(([q, a], i) => (
              <div className="border-b border-[#dfe4dc] py-5" key={q}>
                <button
                  onClick={() => setOpen(open === i ? null : i)}
                  className="flex w-full items-center justify-between text-left font-bold"
                >
                  {q}
                  <ChevronDown
                    className={`transition ${open === i ? 'rotate-180' : ''}`}
                  />
                </button>
                {open === i && (
                  <p className="muted text-sm leading-7 mt-4 max-w-2xl">
                    {a}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="bg-[#07152f] text-white py-10">
        <div className="container flex flex-col md:flex-row justify-between gap-8">
          <div className="font-black text-xl leading-none">
            BATTLE<span className="text-[#D9F36A]">.</span>
            <br />
            MILES
          </div>
          <div className="text-sm text-white/55">
            Run strong. Go further. Build a healthy tomorrow.
          </div>
          <div className="text-xs text-white/45">
            Event contact details to be confirmed by the organiser.
          </div>
        </div>
      </footer>
    </main>
  );
}
