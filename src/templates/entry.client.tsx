import * as React from 'react';
import { hydrateRoot } from 'react-dom/client';
import { HydratedRouter } from 'react-router/dom';

React.startTransition(() => {
    hydrateRoot(
        document,
        <React.StrictMode>
            <HydratedRouter />
        </React.StrictMode>,
    );
});
