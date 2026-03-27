import React, { useState } from 'react';

interface MessageMenuProps {
    messageId: number;
    messageText: string;
    senderName: string;
    isOwn: boolean;
    isGroup?: boolean;
    onReply: () => void;
    onCopy: () => void;
    onEdit: (newText: string) => void;
    onDelete: () => void;
    onClose: () => void;
}

const MessageMenu: React.FC<MessageMenuProps> = ({
    messageId,
    messageText,
    senderName,
    isOwn,
    isGroup,
    onReply,
    onCopy,
    onEdit,
    onDelete,
    onClose
}) => {
    const [isEditing, setIsEditing] = useState<boolean>(false);
    const [editText, setEditText] = useState<string>(messageText);
    const [closing, setClosing] = useState(false);
    const close = () => { setClosing(true); setTimeout(onClose, 140); };

    const handleEdit = (): void => {
        if (editText.trim() && editText !== messageText) {
            onEdit(editText);
        }
        setIsEditing(false);
    };

    const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>): void => {
        if (e.key === 'Enter') {
            handleEdit();
        }
    };

    if (isEditing) {
        return (
            <div style={styles.editContainer}>
                <input
                    type="text"
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onKeyPress={handleKeyPress}
                    autoFocus
                    style={styles.editInput}
                />
                <button onClick={handleEdit} style={styles.editButton}>
                    ✓
                </button>
                <button onClick={() => setIsEditing(false)} style={styles.cancelButton}>
                    ✕
                </button>
            </div>
        );
    }

    return (
        <div style={styles.menu} className={closing ? 'floating-exit' : 'floating-enter'} onClick={(e) => e.stopPropagation()}>
            <button onClick={() => { onReply(); close(); }} style={styles.menuItem}>
                ↩️ Ответить
            </button>
            <button onClick={() => { onCopy(); close(); }} style={styles.menuItem}>
                📋 Копировать
            </button>
            {isOwn && (
                <>
                    <button onClick={() => setIsEditing(true)} style={styles.menuItem}>
                        ✏️ Редактировать
                    </button>
                    <button onClick={() => { onDelete(); close(); }} style={{ ...styles.menuItem, color: '#f44336' }}>
                        🗑️ Удалить
                    </button>
                </>
            )}
            <button onClick={close} style={styles.menuItem}>
                ❌ Отмена
            </button>
        </div>
    );
};

const styles: { [key: string]: React.CSSProperties } = {
    menu: {
        backgroundColor: 'white',
        borderRadius: '8px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.15)',
        padding: '4px 0',
        zIndex: 1000,
        minWidth: '160px',
    },
    menuItem: {
        display: 'block',
        width: '100%',
        padding: '10px 16px',
        textAlign: 'left' as const,
        border: 'none',
        background: 'none',
        cursor: 'pointer',
        fontSize: '14px',
        transition: 'background-color 0.2s',
    },
    editContainer: {
        display: 'flex',
        gap: '8px',
        padding: '8px',
        backgroundColor: 'white',
        borderRadius: '8px',
        boxShadow: '0 2px 10px rgba(0,0,0,0.15)',
    },
    editInput: {
        flex: 1,
        padding: '8px 12px',
        border: '1px solid #ddd',
        borderRadius: '6px',
        fontSize: '14px',
        outline: 'none',
    },
    editButton: {
        padding: '8px 12px',
        backgroundColor: '#1a73e8',
        color: 'white',
        border: 'none',
        borderRadius: '6px',
        cursor: 'pointer',
    },
    cancelButton: {
        padding: '8px 12px',
        backgroundColor: '#f0f2f5',
        border: 'none',
        borderRadius: '6px',
        cursor: 'pointer',
    },
};

export default MessageMenu;