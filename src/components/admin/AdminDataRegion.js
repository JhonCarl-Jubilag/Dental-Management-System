import React from 'react';
import './AdminDataRegion.css';

const AdminDataRegion = ({ loading, hasLoaded, error, label, onRetry, children }) => (
  <section className="admin-data-region" aria-label={label} aria-busy={loading}>
    {loading && (
      <div className="admin-data-region__status" role="status">
        <i className="fas fa-spinner fa-spin" aria-hidden="true"></i>
        {hasLoaded ? `Updating ${label.toLowerCase()}…` : `Loading ${label.toLowerCase()}…`}
      </div>
    )}
    {error && !loading && (
      <div className="admin-data-region__error" role="alert">
        <span>{hasLoaded ? 'Could not update the data. Previous results are shown.' : 'Could not load the data.'}</span>
        <button type="button" className="btn btn-secondary" onClick={onRetry}>Retry</button>
      </div>
    )}
    {hasLoaded && (
      <fieldset className="admin-data-region__content" disabled={loading}>
        {children}
      </fieldset>
    )}
  </section>
);

export default AdminDataRegion;
