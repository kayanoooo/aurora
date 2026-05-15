import React from 'react';

export const DevBadge: React.FC<{ size?: number; title?: string }> = ({ size = 16, title = 'Aurora Developer' }) => (
    <span title={title} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: size, height: size, borderRadius: '50%', background: 'linear-gradient(135deg,#f59e0b,#ef4444)', flexShrink: 0, cursor: 'default' }}>
        <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>
    </span>
);

export const TesterBadge: React.FC<{ size?: number; title?: string }> = ({ size = 16, title = 'Aurora Tester' }) => (
    <span title={title} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: size, height: size, borderRadius: '50%', background: 'linear-gradient(135deg,#10b981,#06b6d4)', flexShrink: 0, cursor: 'default' }}>
        <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v11m0 0H5a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2h-4"/></svg>
    </span>
);

export const TESTER_TAGS = ['even', 'revesore', 'kokoko'];
export const DEV_TAGS = ['kayano', 'durov'];
