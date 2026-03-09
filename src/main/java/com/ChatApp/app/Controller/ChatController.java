package com.ChatApp.app.Controller;

import com.ChatApp.app.model.ChatMessage;
import org.springframework.messaging.handler.annotation.DestinationVariable;
import org.springframework.messaging.handler.annotation.MessageMapping;
import org.springframework.messaging.handler.annotation.SendTo;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

@Controller
public class ChatController {

    private final SimpMessagingTemplate messagingTemplate;

    // roomCode -> set of usernames currently in room
    private final Map<String, Set<String>> roomMembers = new ConcurrentHashMap<>();

    public ChatController(SimpMessagingTemplate messagingTemplate) {
        this.messagingTemplate = messagingTemplate;
    }

    // ── Normal chat messages ──
    @MessageMapping("/sendMessage/{room}")
    @SendTo("/topic/messages/{room}")
    public ChatMessage sendMessage(@DestinationVariable String room, ChatMessage message) {
        message.setRoom(room);
        return message;
    }

    // ── Join room: track member, broadcast updated list ──
    @MessageMapping("/join/{room}")
    public void joinRoom(@DestinationVariable String room, ChatMessage message) {
        roomMembers.computeIfAbsent(room, k -> Collections.synchronizedSet(new LinkedHashSet<>()))
                .add(message.getSender());

        // broadcast join event
        message.setType(ChatMessage.MessageType.JOIN);
        message.setRoom(room);
        messagingTemplate.convertAndSend("/topic/messages/" + room, message);

        // broadcast updated member list
        broadcastMembers(room);
    }

    // ── Leave room ──
    @MessageMapping("/leave/{room}")
    public void leaveRoom(@DestinationVariable String room, ChatMessage message) {
        Set<String> members = roomMembers.get(room);
        if (members != null) members.remove(message.getSender());

        message.setType(ChatMessage.MessageType.LEAVE);
        message.setRoom(room);
        messagingTemplate.convertAndSend("/topic/messages/" + room, message);

        broadcastMembers(room);
    }

    // ── Typing indicator ──
    @MessageMapping("/typing/{room}")
    @SendTo("/topic/typing/{room}")
    public ChatMessage typing(@DestinationVariable String room, ChatMessage message) {
        message.setRoom(room);
        return message;
    }

    // ── Broadcast member list to room ──
    private void broadcastMembers(String room) {
        Set<String> members = roomMembers.getOrDefault(room, Collections.emptySet());
        ChatMessage memberMsg = new ChatMessage();
        memberMsg.setType(ChatMessage.MessageType.CHAT);
        memberMsg.setSender("__members__");
        memberMsg.setMessage(String.join(",", members));
        memberMsg.setRoom(room);
        messagingTemplate.convertAndSend("/topic/members/" + room, memberMsg);
    }

    @GetMapping("/chat")
    public String chat() {
        return "chat";
    }
}