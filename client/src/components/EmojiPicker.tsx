import React, { useState, useEffect, useRef, useCallback } from 'react';

const CATEGORIES = [
    { label: '😀', name: 'Смайлы', emojis: ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','🙃','😉','😌','😍','🥰','😘','😋','😛','😝','😜','🤪','🧐','🤓','😎','😏','😒','😔','😟','😕','☹️','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','😥','😓','🤗','🤔','🤭','🤫','🤥','😶','😐','😑','😬','🙄','😯','😮','🥱','😴','😵','🤢','🤮','🤧','😷','🤒','🤕'] },
    { label: '👋', name: 'Жесты', emojis: ['👋','🤚','🖐','✋','🖖','👌','🤌','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','👍','👎','✊','👊','🤛','🤜','👏','🙌','👐','🤲','🤝','🙏','💪','💅','🖕','✍️','🤳'] },
    { label: '❤️', name: 'Символы', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','✨','💫','⭐','🌟','🔥','💥','💢','💨','💦','💧','💤','🔔','🔕','💬','💭','👁️‍🗨️','🗯️','‼️','⁉️','✅','❌','❎','💯','🔴','🟠','🟡','🟢','🔵','🟣','⚫','⚪','🟤'] },
    { label: '🎉', name: 'Праздники', emojis: ['🎉','🎊','🎈','🎁','🎀','🏆','🥇','🥈','🥉','🏅','🎖️','🎪','🎭','🎨','🎬','🎤','🎧','🎼','🎹','🥁','🎷','🎺','🎸','🎮','🕹️','🎲','🎯','🎳','🃏','🀄','🎱','🎳','🎻'] },
    { label: '🐱', name: 'Животные', emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐔','🐧','🐦','🦆','🦅','🦉','🦇','🐺','🐴','🦄','🐝','🦋','🐌','🐞','🐢','🐍','🦎','🐙','🐬','🐳','🐋','🦈','🦑','🐡','🐠','🐟','🦓','🦒','🦘','🐘','🦏','🐪','🦬','🦙'] },
    { label: '🍕', name: 'Еда', emojis: ['🍎','🍊','🍋','🍌','🍉','🍇','🍓','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🌽','🥕','🍕','🍔','🍟','🌭','🍿','🧂','🥓','🍗','🍖','🍣','🍱','🥟','🦪','🍜','🍝','🍛','🍲','🫕','🥘','🍳','🧇','🥞','🧈','🍞','🥐','🥯','🧀','🥚','🍰','🎂','🧁','🍩','🍪','🍫','🍬','🍭','🍮','🍯','🍺','🍻','🥂','🍷','🥃','🍸','🍹','☕','🍵','🧃','🥤','🧋'] },
    { label: '⚽', name: 'Разное', emojis: ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🏓','🏸','🏒','🥍','🏑','🏏','⛳','🎿','🛷','🥌','🎯','🪃','🎳','🏹','🎣','🤿','🎽','🎪','🚗','🚕','🚙','🚌','🚎','🏎️','🚓','🚑','🚒','✈️','🚀','🛸','🚂','⛵','🛥️','🚁','🛺','🚲','🛵','🏠','🏡','🏢','🏦','🏨','🏩','🏪','🏫','🏬','🏭','🏯','🏰','🗼','🗽','⛪','🕌','⛩️','🌍','🌎','🌏','⛰️','🌋','🏕️','🏖️','🏜️','🏝️','🌅','🌄','🌠','🎇','🎆'] },
];

interface EmojiPickerProps {
    onSelect: (emoji: string) => void;
    onClose: () => void;
    isDark?: boolean;
}

const EmojiPicker: React.FC<EmojiPickerProps> = ({ onSelect, onClose, isDark = false }) => {
    const [activeCategory, setActiveCategory] = useState(0);
    const [closing, setClosing] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const dm = isDark;

    const close = useCallback(() => {
        setClosing(true);
        setTimeout(onClose, 140);
    }, [onClose]);

    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                close();
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [close]);

    const pickerStyle: React.CSSProperties = {
        position: 'absolute',
        bottom: 60,
        right: 80,
        backgroundColor: dm ? '#1e1e2e' : 'white',
        borderRadius: 12,
        boxShadow: dm ? '0 4px 20px rgba(0,0,0,0.5)' : '0 4px 20px rgba(0,0,0,0.2)',
        width: 320,
        zIndex: 500,
        overflow: 'hidden',
        border: `1px solid ${dm ? '#3a3a4a' : '#e0e0e0'}`,
    };

    const tabsStyle: React.CSSProperties = {
        display: 'flex',
        overflowX: 'auto',
        padding: '6px 8px',
        borderBottom: `1px solid ${dm ? '#3a3a4a' : '#f0f0f0'}`,
        gap: 2,
    };

    const catNameStyle: React.CSSProperties = {
        padding: '4px 12px',
        fontSize: 11,
        color: dm ? '#888' : '#999',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        backgroundColor: dm ? '#2a2a3a' : '#f8f9fa',
    };

    const gridStyle: React.CSSProperties = {
        display: 'flex',
        flexWrap: 'wrap',
        padding: 8,
        maxHeight: 200,
        overflowY: 'auto',
        backgroundColor: dm ? '#1e1e2e' : 'white',
    };

    return (
        <div ref={ref} style={pickerStyle} className={closing ? 'floating-exit' : 'floating-enter'} onClick={e => e.stopPropagation()}>
            {/* Category tabs */}
            <div style={tabsStyle}>
                {CATEGORIES.map((cat, i) => (
                    <button
                        key={i}
                        onClick={() => setActiveCategory(i)}
                        style={{
                            ...styles.tabBtn,
                            backgroundColor: activeCategory === i ? (dm ? '#2d3a5a' : '#e8f0fe') : 'transparent',
                        }}
                        title={cat.name}
                    >
                        {cat.label}
                    </button>
                ))}
            </div>

            {/* Category name */}
            <div style={catNameStyle}>{CATEGORIES[activeCategory].name}</div>

            {/* Emoji grid */}
            <div style={gridStyle}>
                {CATEGORIES[activeCategory].emojis.map((emoji, i) => (
                    <button
                        key={i}
                        onClick={() => onSelect(emoji)}
                        style={{ ...styles.emojiBtn, color: dm ? '#e0e0e0' : 'inherit' }}
                        title={emoji}
                    >
                        {emoji}
                    </button>
                ))}
            </div>
        </div>
    );
};

const styles: { [key: string]: React.CSSProperties } = {
    tabBtn: {
        background: 'none',
        border: 'none',
        fontSize: 18,
        cursor: 'pointer',
        padding: '4px 6px',
        borderRadius: 6,
        flexShrink: 0,
    },
    emojiBtn: {
        background: 'none',
        border: 'none',
        fontSize: 22,
        cursor: 'pointer',
        padding: '4px 5px',
        borderRadius: 6,
        lineHeight: 1,
        transition: 'background 0.1s',
    },
};

export default EmojiPicker;