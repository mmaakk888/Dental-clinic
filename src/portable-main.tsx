import React,{StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import PortableRoot from './portable/PortableRoot';
import {ErrorBoundary} from './components/common/ErrorBoundary';
import './index.css';
import './components/home/HomeView.css';
import './components/common/HeaderNavbar.css';
import './components/common/workspaceLayout.css';
import './components/navigation/dockAppearance.css';
createRoot(document.getElementById('root')!).render(<StrictMode><ErrorBoundary><PortableRoot/></ErrorBoundary></StrictMode>);

import './styles/interfaceQuality.css';
