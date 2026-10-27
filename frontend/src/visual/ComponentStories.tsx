import { ReactNode } from 'react';
import { StorySection } from './scaffold';

/**
 * Component stories: the reusable UI primitives rendered straight from the
 * real class names in styles.css. Grouped by component so a regression in,
 * say, the pill or button styling is isolated to one screenshot.
 */

function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="story-cell">
      <span className="story-label">{label}</span>
      {children}
    </div>
  );
}

export function Buttons() {
  return (
    <StorySection id="buttons" title="Buttons">
      <div className="story-row" style={{ marginBottom: '0.6rem' }}>
        <Cell label="default">
          <button type="button" className="btn">Default</button>
        </Cell>
        <Cell label="primary">
          <button type="button" className="btn btn-primary">Primary</button>
        </Cell>
        <Cell label="danger">
          <button type="button" className="btn btn-danger">Danger</button>
        </Cell>
        <Cell label="ghost">
          <button type="button" className="btn btn-ghost">Ghost</button>
        </Cell>
        <Cell label="disabled">
          <button type="button" className="btn" disabled>Disabled</button>
        </Cell>
      </div>
      <div className="story-row">
        <Cell label="sm">
          <button type="button" className="btn btn-sm">Small</button>
        </Cell>
        <Cell label="sm primary">
          <button type="button" className="btn btn-sm btn-primary">Small primary</button>
        </Cell>
        <Cell label="sm danger">
          <button type="button" className="btn btn-sm btn-danger">Small danger</button>
        </Cell>
        <Cell label="block">
          <span style={{ minWidth: '180px' }}>
            <button type="button" className="btn btn-primary btn-block">Block</button>
          </span>
        </Cell>
      </div>
    </StorySection>
  );
}

export function Pills() {
  return (
    <StorySection id="pills" title="Pills">
      <div className="story-row">
        <Cell label="default"><span className="pill">Default</span></Cell>
        <Cell label="gold"><span className="pill pill-gold">Gold</span></Cell>
        <Cell label="bench"><span className="pill pill-bench">Bench</span></Cell>
        <Cell label="training"><span className="pill pill-training">Training</span></Cell>
        <Cell label="inactive"><span className="pill pill-inactive">Inactive</span></Cell>
        <Cell label="open"><span className="pill pill-open">Open</span></Cell>
        <Cell label="filled"><span className="pill pill-filled">Filled</span></Cell>
        <Cell label="closed"><span className="pill pill-closed">Closed</span></Cell>
        <Cell label="danger"><span className="pill pill-danger">Danger</span></Cell>
        <Cell label="muted"><span className="pill pill-muted">Muted</span></Cell>
      </div>
    </StorySection>
  );
}

export function Stats() {
  return (
    <StorySection id="stats" title="Stats">
      <div className="stats-row" style={{ marginBottom: 0 }}>
        <div className="stat card">
          <span className="stat-value">128</span>
          <span className="stat-label">Total reps</span>
        </div>
        <div className="stat card">
          <span className="stat-value">42</span>
          <span className="stat-label">On bench</span>
        </div>
        <div className="stat card">
          <span className="stat-value">86%</span>
          <span className="stat-label">Placement rate</span>
        </div>
        <div className="stat card">
          <span className="stat-value">12</span>
          <span className="stat-label">Open offers</span>
        </div>
      </div>
    </StorySection>
  );
}

export function Forms() {
  return (
    <StorySection id="forms" title="Form controls">
      <div className="story-grid">
        <div className="field">
          <label htmlFor="v-name">Text input</label>
          <input id="v-name" placeholder="Placeholder value" defaultValue="Dana Scott" />
        </div>
        <div className="field">
          <label htmlFor="v-email">Email</label>
          <input id="v-email" type="email" defaultValue="dana@example.test" />
        </div>
        <div className="field">
          <label htmlFor="v-select">Select</label>
          <select id="v-select" defaultValue="2">
            <option value="1">Junior</option>
            <option value="2">Mid</option>
            <option value="3">Senior</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="v-disabled">Disabled</label>
          <input id="v-disabled" disabled value="Read only" readOnly />
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label htmlFor="v-a">First</label>
          <input id="v-a" defaultValue="One" />
        </div>
        <div className="field">
          <label htmlFor="v-b">Second</label>
          <input id="v-b" defaultValue="Two" />
        </div>
        <div className="field">
          <label htmlFor="v-c">Third</label>
          <input id="v-c" defaultValue="Three" />
        </div>
      </div>
      <div className="field">
        <label htmlFor="v-area">Textarea</label>
        <textarea id="v-area" rows={3} defaultValue="Multi-line notes go here." />
      </div>
      <div className="field">
        <label>Filter chips</label>
        <span className="chip selected">Sales</span>
        <span className="chip">Advertising</span>
        <span className="chip">Partnerships</span>
      </div>
      <p className="error-text">Something went wrong — inline error message.</p>
    </StorySection>
  );
}

export function Cards() {
  return (
    <StorySection id="cards" title="Cards">
      <div className="rep-grid">
        <article className="card card-hover rep-card">
          <div className="rep-head">
            <span className="avatar">DS</span>
            <div>
              <div className="name">Dana Scott</div>
              <div className="rep-meta">
                <span>Sales</span>
                <span>·</span>
                <span>Mid</span>
              </div>
            </div>
          </div>
          <div className="rep-tags">
            <span className="pill pill-bench">Bench</span>
            <span className="pill">Available now</span>
          </div>
          <p className="rep-notes">Great closer with enterprise experience.</p>
          <div className="rep-actions">
            <button type="button" className="btn btn-sm">Place on offer</button>
            <button type="button" className="btn btn-sm">View profile</button>
          </div>
        </article>

        <article className="card card-hover rep-card offer-card">
          <div className="offer-head">
            <div>
              <div className="name">Enterprise AE</div>
              <div className="rep-meta">Northwind Retail</div>
            </div>
            <span className="pill pill-open">OPEN</span>
          </div>
          <div className="rep-tags req-chips">
            <span className="pill pill-gold">Needs: closing, CRM</span>
            <span className="pill">Mid+</span>
            <span className="pill">Speaks English</span>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: '50%' }} />
          </div>
          <div className="seat-label">1/2 seats filled</div>
          <div className="rep-chips">
            <span className="rep-chip">Amara Okafor</span>
            <span className="rep-chip">Diego Ramirez</span>
          </div>
          <div className="rep-actions">
            <button type="button" className="btn btn-sm">Suggest reps</button>
            <button type="button" className="btn btn-sm">Edit</button>
            <button type="button" className="btn btn-sm btn-danger">Close</button>
          </div>
        </article>
      </div>
    </StorySection>
  );
}

export function BoardCard() {
  return (
    <StorySection id="board" title="Board column">
      <div className="board-grid">
        <section className="board-col">
          <header className="board-col-head">
            <h2>Sourcing</h2>
            <span className="board-count">2 offers</span>
          </header>
          <ul className="board-list">
            <li className="board-card">
              <div className="board-card-top">
                <h3>Retail Sales Lead</h3>
                <span className="pill pill-open">OPEN</span>
              </div>
              <div className="muted board-client">Northwind Retail</div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: '0%' }} />
              </div>
              <div className="seat-label">0/1 seats filled</div>
              <div className="board-move">
                <label className="sr-only" htmlFor="v-move-1">Move to stage</label>
                <select id="v-move-1" defaultValue="1">
                  <option value="1">Sourcing</option>
                  <option value="2">Interviewing</option>
                  <option value="3">Onboarding</option>
                  <option value="4">Live</option>
                </select>
              </div>
            </li>
            <li className="board-card">
              <div className="board-card-top">
                <h3>Media Buyer</h3>
                <span className="pill pill-filled">FILLED</span>
              </div>
              <div className="muted board-client">Lumen Media</div>
              <div className="progress-track">
                <div className="progress-fill full" style={{ width: '100%' }} />
              </div>
              <div className="seat-label">2/2 seats filled</div>
              <div className="board-move">
                <label className="sr-only" htmlFor="v-move-2">Move to stage</label>
                <select id="v-move-2" defaultValue="1">
                  <option value="1">Sourcing</option>
                  <option value="2">Interviewing</option>
                  <option value="3">Onboarding</option>
                  <option value="4">Live</option>
                </select>
              </div>
            </li>
          </ul>
        </section>

        <section className="board-col">
          <header className="board-col-head">
            <h2>Interviewing</h2>
            <span className="board-count">1 offer</span>
          </header>
          <ul className="board-list">
            <li className="board-card">
              <div className="board-card-top">
                <h3>BDR Team Lead</h3>
                <span className="pill pill-open">OPEN</span>
              </div>
              <div className="muted board-client">Acme SaaS</div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: '0%' }} />
              </div>
              <div className="seat-label">0/1 seats filled</div>
              <div className="board-move">
                <label className="sr-only" htmlFor="v-move-3">Move to stage</label>
                <select id="v-move-3" defaultValue="2">
                  <option value="1">Sourcing</option>
                  <option value="2">Interviewing</option>
                  <option value="3">Onboarding</option>
                  <option value="4">Live</option>
                </select>
              </div>
            </li>
          </ul>
        </section>

        <section className="board-col">
          <header className="board-col-head">
            <h2>Live</h2>
            <span className="board-count">0 offers</span>
          </header>
          <p className="board-empty">No offers in this stage.</p>
        </section>
      </div>
    </StorySection>
  );
}

export function EmptyStates() {
  return (
    <StorySection id="empty-states" title="Empty states">
      <div className="empty-state">
        <div className="empty-title">No matching offers</div>
        <p>Adjust the filters or add a new offer to get started.</p>
      </div>
      <div className="empty-state" style={{ marginTop: '0.8rem' }} role="status">
        <div className="empty-title">Performance is a Pro feature</div>
        <p>Upgrade to unlock performance tracking and commissions.</p>
      </div>
    </StorySection>
  );
}

export function SettingsRows() {
  return (
    <StorySection id="settings-rows" title="Settings rows">
      <section className="settings-section card">
        <div className="table-bar">
          <input placeholder="Search verticals…" />
          <button type="button" className="btn btn-primary btn-sm">Add</button>
        </div>
        <div className="lookup-row">
          <span className="name">Sales</span>
          <span className="pill">vertical</span>
          <button type="button" className="btn btn-sm">Rename</button>
          <button type="button" className="btn btn-sm btn-danger">Delete</button>
        </div>
        <div className="lookup-row">
          <span className="name">Advertising</span>
          <span className="pill">vertical</span>
          <button type="button" className="btn btn-sm">Rename</button>
          <button type="button" className="btn btn-sm btn-danger">Delete</button>
        </div>
        <div className="lookup-row">
          <span className="name">Partnerships</span>
          <span className="pill">vertical</span>
          <button type="button" className="btn btn-sm">Rename</button>
          <button type="button" className="btn btn-sm btn-danger">Delete</button>
        </div>
      </section>
    </StorySection>
  );
}
