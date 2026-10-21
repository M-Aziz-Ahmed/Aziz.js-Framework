/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        './index.html',
        './app/**/*.{js,jsx,ts,tsx}',
        './components/**/*.{js,jsx,ts,tsx}',
        './lib/**/*.{js,jsx,ts,tsx}',
        './models/**/*.{js,jsx,ts,tsx}',
    ],
    theme: {
        extend: {
            colors: {
                primary: '#61dafb',
                dark: '#282c34',
            },
        },
    },
    plugins: [],
};
