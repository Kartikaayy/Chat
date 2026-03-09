package com.ChatApp.app.model;

import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@NoArgsConstructor
public class ChatMessage {
    private Long id;
    private String sender;
    private String message;
    private String room;
    private MessageType type;

    public enum MessageType {
        CHAT,       // normal message
        JOIN,       // user joined
        LEAVE,      // user left
        TYPING,     // user is typing
        STOP_TYPING // user stopped typing
    }
}