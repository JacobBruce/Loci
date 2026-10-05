const theme = window.lociTheme === 'blue' ? 'blue' : 'brass';
const link = document.createElement('link');
link.id = 'theme_css';
link.rel = 'stylesheet';
link.href = './theme-' + theme + '.css';
document.head.appendChild(link);
